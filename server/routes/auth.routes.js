"use strict";

const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const pool = require("../db/pool");

const router = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESET_TOKEN_EXPIRY_MINUTES = 15;

/* =========================================
   REGISTER NEW USER
========================================= */
router.post("/register", async (req, res) => {
    try {
        const {
            fullName,
            email,
            phone,
            location,
            role,
            password,
            confirmPassword
        } = req.body || {};

        if (
            typeof fullName !== "string" ||
            typeof email !== "string" ||
            typeof phone !== "string" ||
            typeof location !== "string" ||
            typeof role !== "string" ||
            typeof password !== "string" ||
            typeof confirmPassword !== "string"
        ) {
            return res.status(400).json({
                message: "Please complete all required fields."
            });
        }

        const name = fullName.trim();
        const userEmail = email.trim().toLowerCase();
        const userPhone = phone.trim();
        const userLocation = location.trim();
        const userRole = role.trim().toLowerCase();

        if (name.length < 2 || name.length > 120) {
            return res.status(400).json({
                message: "Full name must contain 2 to 120 characters."
            });
        }

        if (
            userEmail.length > 190 ||
            !EMAIL_PATTERN.test(userEmail)
        ) {
            return res.status(400).json({
                message: "Please provide a valid email address."
            });
        }

        if (userPhone.length < 5 || userPhone.length > 30) {
            return res.status(400).json({
                message: "Please enter a valid phone number."
            });
        }

        if (
            userLocation.length === 0 ||
            userLocation.length > 150
        ) {
            return res.status(400).json({
                message: "Please enter a valid town or district."
            });
        }

        if (!["farmer", "buyer"].includes(userRole)) {
            return res.status(400).json({
                message: "Account type must be Farmer or Buyer."
            });
        }

        if (
            password.length < 8 ||
            Buffer.byteLength(password, "utf8") > 72
        ) {
            return res.status(400).json({
                message:
                    "Password must be at least 8 characters and no more than 72 UTF-8 bytes."
            });
        }

        if (password !== confirmPassword) {
            return res.status(400).json({
                message: "Passwords do not match."
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);

        const [result] = await pool.execute(
            `INSERT INTO users
                (full_name, email, phone, location, password_hash, role)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                name,
                userEmail,
                userPhone,
                userLocation,
                passwordHash,
                userRole
            ]
        );

        return res.status(201).json({
            message: "Registration successful! You can now log in.",
            user: {
                userId: result.insertId,
                fullName: name,
                email: userEmail,
                role: userRole
            }
        });
    } catch (error) {
        if (error.code === "ER_DUP_ENTRY") {
            return res.status(409).json({
                message: "This email address is already registered."
            });
        }

        console.error("Registration error:", error.message);

        return res.status(500).json({
            message: "Registration failed. Please try again."
        });
    }
});


/* =========================================
   LOGIN
========================================= */
router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body || {};

        if (
            typeof email !== "string" ||
            typeof password !== "string" ||
            email.trim() === "" ||
            password === ""
        ) {
            return res.status(400).json({
                message: "Please enter your email and password."
            });
        }

        const userEmail = email.trim().toLowerCase();

        const [users] = await pool.execute(
            `SELECT user_id, full_name, email, password_hash, role
             FROM users
             WHERE email = ? AND is_active = 1
             LIMIT 1`,
            [userEmail]
        );

        if (users.length === 0) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        const user = users[0];

        const passwordMatches = await bcrypt.compare(
            password,
            user.password_hash
        );

        if (!passwordMatches) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        req.session.regenerate((error) => {
            if (error) {
                console.error("Session error:", error.message);

                return res.status(500).json({
                    message: "Unable to create your login session."
                });
            }

            req.session.user = {
                userId: user.user_id,
                fullName: user.full_name,
                email: user.email,
                role: user.role
            };

            req.session.save((saveError) => {
                if (saveError) {
                    console.error(
                        "Session save error:",
                        saveError.message
                    );

                    return res.status(500).json({
                        message: "Unable to save your login session."
                    });
                }

                return res.status(200).json({
                    message: "Login successful!",
                    user: req.session.user
                });
            });
        });
    } catch (error) {
        console.error("Login error:", error.message);

        return res.status(500).json({
            message: "A server error occurred during login."
        });
    }
});


/* =========================================
   FORGOT PASSWORD
   Local development reset link
========================================= */
router.post("/forgot-password", async (req, res) => {
    const genericMessage =
        "If an active account exists for that email, reset instructions can be generated.";

    try {
        const email =
            typeof req.body?.email === "string"
                ? req.body.email.trim().toLowerCase()
                : "";

        if (
            email.length > 190 ||
            !EMAIL_PATTERN.test(email)
        ) {
            return res.status(400).json({
                message: "Please enter a valid email address."
            });
        }

        const [users] = await pool.execute(
            `SELECT user_id, email
             FROM users
             WHERE email = ? AND is_active = 1
             LIMIT 1`,
            [email]
        );

        // Do not reveal whether an email belongs to an account.
        if (users.length === 0) {
            return res.status(200).json({
                message: genericMessage
            });
        }

        const user = users[0];

        // Generate a cryptographically secure, single-use token.
        const rawToken = crypto.randomBytes(32).toString("hex");

        const tokenHash = crypto
            .createHash("sha256")
            .update(rawToken)
            .digest("hex");

        const connection = await pool.getConnection();

        try {
            await connection.beginTransaction();

            // Invalidate previous outstanding reset tokens.
            await connection.execute(
                `UPDATE password_reset_tokens
                 SET used_at = NOW()
                 WHERE user_id = ? AND used_at IS NULL`,
                [user.user_id]
            );

            await connection.execute(
                `INSERT INTO password_reset_tokens
                    (user_id, token_hash, expires_at)
                 VALUES (
                    ?,
                    ?,
                    DATE_ADD(NOW(), INTERVAL ? MINUTE)
                 )`,
                [
                    user.user_id,
                    tokenHash,
                    RESET_TOKEN_EXPIRY_MINUTES
                ]
            );

            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }

        const response = {
            message: genericMessage
        };

        // Local development only. Never expose reset tokens in production.
        if (process.env.NODE_ENV !== "production") {
            response.resetUrl =
                `http://localhost:3000/login/reset-password.html?token=${rawToken}`;
        }

        return res.status(200).json(response);
    } catch (error) {
        console.error("Forgot-password error:", error.message);

        return res.status(500).json({
            message: "Unable to process your request. Please try again."
        });
    }
});


/* =========================================
   RESET PASSWORD
========================================= */
router.post("/reset-password", async (req, res) => {
    const { token, password, confirmPassword } = req.body || {};

    if (
        typeof token !== "string" ||
        !/^[a-f0-9]{64}$/i.test(token)
    ) {
        return res.status(400).json({
            message: "The reset link is invalid or has expired."
        });
    }

    if (
        typeof password !== "string" ||
        password.length < 8 ||
        Buffer.byteLength(password, "utf8") > 72
    ) {
        return res.status(400).json({
            message:
                "Password must be at least 8 characters and no more than 72 UTF-8 bytes."
        });
    }

    if (password !== confirmPassword) {
        return res.status(400).json({
            message: "Passwords do not match."
        });
    }

    let connection;

    try {
        const tokenHash = crypto
            .createHash("sha256")
            .update(token)
            .digest("hex");

        const passwordHash = await bcrypt.hash(password, 12);

        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [tokens] = await connection.execute(
            `SELECT id, user_id
             FROM password_reset_tokens
             WHERE token_hash = ?
               AND used_at IS NULL
               AND expires_at > NOW()
             LIMIT 1
             FOR UPDATE`,
            [tokenHash]
        );

        if (tokens.length === 0) {
            await connection.rollback();

            return res.status(400).json({
                message: "The reset link is invalid or has expired."
            });
        }

        const resetRecord = tokens[0];

        const [updatedUsers] = await connection.execute(
            `UPDATE users
             SET password_hash = ?
             WHERE user_id = ? AND is_active = 1`,
            [passwordHash, resetRecord.user_id]
        );

        if (updatedUsers.affectedRows !== 1) {
            await connection.rollback();

            return res.status(400).json({
                message: "The account is unavailable. Request a new reset link."
            });
        }

        const [updatedToken] = await connection.execute(
            `UPDATE password_reset_tokens
             SET used_at = NOW()
             WHERE id = ? AND used_at IS NULL`,
            [resetRecord.id]
        );

        if (updatedToken.affectedRows !== 1) {
            await connection.rollback();

            return res.status(400).json({
                message: "The reset link has already been used."
            });
        }

        // Invalidate all other outstanding tokens for this account.
        await connection.execute(
            `UPDATE password_reset_tokens
             SET used_at = NOW()
             WHERE user_id = ?
               AND id <> ?
               AND used_at IS NULL`,
            [resetRecord.user_id, resetRecord.id]
        );

        await connection.commit();

        return res.status(200).json({
            message:
                "Your password has been reset successfully. You can now log in."
        });
    } catch (error) {
        if (connection) {
            await connection.rollback().catch(() => {});
        }

        console.error("Reset-password error:", error.message);

        return res.status(500).json({
            message: "Unable to reset the password. Please try again."
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});


/* =========================================
   GET CURRENT LOGGED-IN USER
========================================= */
router.get("/me", (req, res) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            message: "Please log in to continue."
        });
    }

    return res.status(200).json({
        user: req.session.user
    });
});


/* =========================================
   LOGOUT
========================================= */
router.post("/logout", (req, res) => {
    if (!req.session) {
        return res.status(200).json({
            message: "Logged out successfully."
        });
    }

    req.session.destroy((error) => {
        if (error) {
            console.error("Logout error:", error.message);

            return res.status(500).json({
                message: "Unable to log out. Please try again."
            });
        }

        // Match the cookie name configured in server/app.js.
        res.clearCookie("connect.sid", {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production"
        });

        return res.status(200).json({
            message: "Logged out successfully."
        });
    });
});


/* =========================================
   EXPORT ROUTER
========================================= */
module.exports = router;
