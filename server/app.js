
"use strict";

require("dotenv").config();

const express = require("express");
const session = require("express-session");
const path = require("path");
const fs = require("fs");

const pool = require("./db/pool");

const authRoutes = require("./routes/auth.routes");
const farmerRoutes = require("./routes/farmer.routes");
const buyerRoutes = require("./routes/buyer.routes");

// Keep the route filenames consistent with your project.
const paymentRoutes = require("./routes/payment.routes");
const farmerPaymentsRoutes = require("./routes/farmer-payments.routes");
const adminRoutes = require("./routes/admin.routes");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const clientPath = path.join(__dirname, "..", "client");

// Validate required configuration.
if (!process.env.SESSION_SECRET) {
    throw new Error("SESSION_SECRET is missing from your .env file.");
}

// Only enable this when running behind a trusted reverse proxy.
if (process.env.TRUST_PROXY === "true") {
    app.set("trust proxy", 1);
}

// Parse incoming requests.
app.use(express.json({ limit: "1mb" }));
app.use(
    express.urlencoded({
        extended: true,
        limit: "1mb"
    })
);

// Configure sessions.
app.use(
    session({
        name: "agroconnect.sid",
        secret: process.env.SESSION_SECRET,
        resave: false,
        saveUninitialized: false,
        cookie: {
            httpOnly: true,
            secure: process.env.NODE_ENV === "production",
            sameSite: "lax",
            maxAge: 1000 * 60 * 60 * 24
        }
    })
);

// Register API routes before frontend static files.
app.use("/api/auth", authRoutes);
app.use("/api/farmer", farmerRoutes);
app.use("/api/buyer", buyerRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/farmer-payments", farmerPaymentsRoutes);
app.use("/api/admin", adminRoutes);

// Database health check.
app.get("/api/health", async (req, res) => {
    try {
        const [rows] = await pool.execute("SELECT 1 AS database_ok");

        return res.json({
            status: "ok",
            message: "AgroConnect and MySQL are running.",
            database: rows[0].database_ok === 1
                ? "connected"
                : "unknown"
        });
    } catch (error) {
        console.error("Health check failed:", error.message);

        return res.status(503).json({
            status: "error",
            message: "The server is running, but the database is unavailable."
        });
    }
});

// Return JSON for unknown API endpoints.
app.use("/api", (req, res) => {
    return res.status(404).json({
        message: "API endpoint not found.",
        path: req.originalUrl,
        method: req.method
    });
});

// Serve frontend files.
if (!fs.existsSync(clientPath)) {
    console.warn("Warning: client directory not found:", clientPath);
}

app.use(express.static(clientPath));

// Default page.
app.get("/", (req, res) => {
    return res.sendFile(
        path.join(clientPath, "login", "login.html"),
        (error) => {
            if (error && !res.headersSent) {
                res.status(error.statusCode || 404).send(
                    "Login page not found. Check client/login/login.html."
                );
            }
        }
    );
});

// Handle unknown frontend pages.
app.use((req, res) => {
    return res.status(404).send("Page not found.");
});

// Central error handler.
app.use((err, req, res, next) => {
    console.error("Server error:", err);

    if (res.headersSent) {
        return next(err);
    }

    return res.status(500).json({
        message: "An unexpected server error occurred."
    });
});

// Start the server.
const server = app.listen(PORT, () => {
    console.log(`AgroConnect Zambia running at http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
});

// Handle startup errors.
server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(
            `Port ${PORT} is already in use. Stop the existing server before restarting.`
        );
    } else {
        console.error("Server startup error:", error.message);
    }

    process.exitCode = 1;
});

// Graceful shutdown.
let shuttingDown = false;

function shutdown() {
    if (shuttingDown) return;

    shuttingDown = true;
    console.log("\nShutting down AgroConnect Zambia...");

    server.close(async (error) => {
        try {
            await pool.end();

            if (error) {
                console.error("Server shutdown error:", error.message);
                process.exitCode = 1;
            } else {
                console.log("Server and database pool closed.");
            }
        } catch (dbError) {
            console.error("Database shutdown error:", dbError.message);
            process.exitCode = 1;
        }
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
