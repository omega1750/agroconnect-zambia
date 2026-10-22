"use strict";

const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

router.use((req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ message: "Please log in first." });
    }

    if (req.session.user.role !== "farmer") {
        return res.status(403).json({ message: "Farmer access only." });
    }

    next();
});

/*
 * GET /api/farmer-payments
 * Show payment records for orders belonging to this farmer.
 */
router.get("/", async (req, res) => {
    try {
        const [payments] = await pool.query(
            `SELECT pay.payment_id AS paymentId,
                    pay.order_id AS orderId,
                    pay.amount,
                    pay.payment_method AS paymentMethod,
                    pay.transaction_reference AS transactionReference,
                    pay.status AS paymentStatus,
                    pay.created_at AS createdAt,
                    o.status AS orderStatus,
                    p.product_name AS productName,
                    u.full_name AS buyerName
             FROM payments pay
             JOIN farmer_orders o ON o.order_id = pay.order_id
             JOIN products p ON p.product_id = o.product_id
             JOIN users u ON u.user_id = pay.buyer_id
             WHERE o.farmer_id = ?
             ORDER BY pay.payment_id DESC`,
            [req.session.user.userId]
        );

        res.json({ payments });
    } catch (error) {
        console.error("Farmer payments error:", error);
        res.status(500).json({
            message: "Unable to load farmer payments. Check your database schema."
        });
    }
});

module.exports = router;