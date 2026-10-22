
"use strict";

const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

/* Protect every admin endpoint. */
router.use((req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            message: "Please log in to continue."
        });
    }

    if (String(req.session.user.role).toLowerCase() !== "admin") {
        return res.status(403).json({
            message: "Administrator access is required."
        });
    }

    next();
});

/* GET /api/admin/overview */
router.get("/overview", async (req, res) => {
    try {
        const [[userCounts]] = await pool.query(`
            SELECT
                COUNT(*) AS totalUsers,
                COALESCE(SUM(role = 'farmer'), 0) AS totalFarmers,
                COALESCE(SUM(role = 'buyer'), 0) AS totalBuyers,
                COALESCE(SUM(role = 'admin'), 0) AS totalAdmins,
                COALESCE(SUM(is_active = 1), 0) AS activeUsers,
                COALESCE(SUM(is_active = 0), 0) AS inactiveUsers
            FROM users
        `);

        const [[productCounts]] = await pool.query(`
            SELECT
                COUNT(*) AS totalProducts,
                COALESCE(SUM(status = 'available'), 0) AS availableProducts,
                COALESCE(SUM(status = 'sold_out'), 0) AS soldOutProducts
            FROM products
        `);

        const [[orderCounts]] = await pool.query(`
            SELECT
                COUNT(*) AS totalOrders,
                COALESCE(SUM(status = 'pending'), 0) AS pendingOrders,
                COALESCE(SUM(status = 'accepted'), 0) AS acceptedOrders,
                COALESCE(SUM(status = 'completed'), 0) AS completedOrders,
                COALESCE(SUM(status = 'rejected'), 0) AS rejectedOrders,
                COALESCE(SUM(status = 'cancelled'), 0) AS cancelledOrders
            FROM farmer_orders
        `);

        const users = {
            total: Number(userCounts.totalUsers),
            farmers: Number(userCounts.totalFarmers),
            buyers: Number(userCounts.totalBuyers),
            admins: Number(userCounts.totalAdmins),
            active: Number(userCounts.activeUsers),
            inactive: Number(userCounts.inactiveUsers)
        };

        const products = {
            total: Number(productCounts.totalProducts),
            available: Number(productCounts.availableProducts),
            soldOut: Number(productCounts.soldOutProducts)
        };

        const orders = {
            total: Number(orderCounts.totalOrders),
            pending: Number(orderCounts.pendingOrders),
            accepted: Number(orderCounts.acceptedOrders),
            completed: Number(orderCounts.completedOrders),
            rejected: Number(orderCounts.rejectedOrders),
            cancelled: Number(orderCounts.cancelledOrders)
        };

        return res.json({
            users,
            products,
            orders,
            totalUsers: users.total,
            totalFarmers: users.farmers,
            totalBuyers: users.buyers,
            totalProducts: products.total,
            availableProducts: products.available,
            totalOrders: orders.total
        });
    } catch (error) {
        console.error("Admin overview error:", error);
        return res.status(500).json({
            message: "Unable to load dashboard statistics."
        });
    }
});

/* GET /api/admin/users?role=farmer&search= */
router.get("/users", async (req, res) => {
    try {
        const search = String(req.query.search || "").trim();
        const role = String(req.query.role || "").trim().toLowerCase();

        const conditions = [];
        const params = [];

        if (["farmer", "buyer", "admin"].includes(role)) {
            conditions.push("role = ?");
            params.push(role);
        }

        if (search) {
            conditions.push(`(
                full_name LIKE ? OR
                email LIKE ? OR
                phone LIKE ? OR
                location LIKE ?
            )`);
            const term = `%${search}%`;
            params.push(term, term, term, term);
        }

        const where = conditions.length
            ? `WHERE ${conditions.join(" AND ")}`
            : "";

        const [users] = await pool.query(`
            SELECT
                user_id,
                full_name,
                email,
                phone,
                location,
                role,
                is_active,
                created_at
            FROM users
            ${where}
            ORDER BY created_at DESC, user_id DESC
            LIMIT 500
        `, params);

        return res.json({ users });
    } catch (error) {
        console.error("Admin users error:", error);
        return res.status(500).json({
            message: "Unable to load users."
        });
    }
});

/* GET /api/admin/products?search= */
router.get("/products", async (req, res) => {
    try {
        const search = String(req.query.search || "").trim();
        const params = [];
        let where = "";

        if (search) {
            where = `WHERE (
                p.product_name LIKE ? OR
                p.description LIKE ? OR
                u.full_name LIKE ?
            )`;
            const term = `%${search}%`;
            params.push(term, term, term);
        }

        const [products] = await pool.query(`
            SELECT
                p.product_id,
                p.farmer_id,
                p.product_name,
                p.description,
                p.price,
                p.quantity,
                p.unit,
                p.image_url,
                p.status,
                p.created_at,
                u.full_name AS farmer_name
            FROM products p
            LEFT JOIN users u ON u.user_id = p.farmer_id
            ${where}
            ORDER BY p.created_at DESC, p.product_id DESC
            LIMIT 500
        `, params);

        return res.json({ products });
    } catch (error) {
        console.error("Admin products error:", error);
        return res.status(500).json({
            message: "Unable to load products."
        });
    }
});

/* PATCH /api/admin/users/:id/status */
router.patch("/users/:id/status", async (req, res) => {
    try {
        const userId = Number(req.params.id);
        const newStatus = req.body.is_active;

        if (!Number.isSafeInteger(userId) || userId < 1) {
            return res.status(400).json({ message: "Invalid user ID." });
        }

        if (![0, 1, false, true].includes(newStatus)) {
            return res.status(400).json({
                message: "is_active must be 0 or 1."
            });
        }

        const activeValue = Number(newStatus);
        const currentAdminId =
            req.session.user.userId ??
            req.session.user.user_id ??
            req.session.user.id;

        if (
            String(userId) === String(currentAdminId) &&
            activeValue === 0
        ) {
            return res.status(400).json({
                message: "You cannot deactivate your own administrator account."
            });
        }

        const [result] = await pool.query(
            "UPDATE users SET is_active = ? WHERE user_id = ?",
            [activeValue, userId]
        );

        if (result.affectedRows === 0) {
            const [existing] = await pool.query(
                "SELECT user_id FROM users WHERE user_id = ? LIMIT 1",
                [userId]
            );

            if (!existing.length) {
                return res.status(404).json({
                    message: "User not found."
                });
            }
        }

        return res.json({
            message: activeValue
                ? "User account activated successfully."
                : "User account deactivated successfully.",
            userId,
            is_active: activeValue
        });
    } catch (error) {
        console.error("Admin user status error:", error);
        return res.status(500).json({
            message: "Unable to update user status."
        });
    }
});

module.exports = router;
