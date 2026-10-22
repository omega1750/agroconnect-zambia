
"use strict";

const express = require("express");
const crypto = require("crypto");
const pool = require("../db/pool");

const router = express.Router();

const METHODS = ["mtn_momo", "airtel_money"];
const TEST_OUTCOMES = ["successful", "failed"];

/* Ensure the request belongs to a logged-in buyer. */
function requireBuyer(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            message: "Please log in first."
        });
    }

    if (String(req.session.user.role).toLowerCase() !== "buyer") {
        return res.status(403).json({
            message: "Buyer access only."
        });
    }

    next();
}

function requireLogin(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            message: "Please log in first."
        });
    }

    next();
}

function createReference() {
    return "AGC-" + crypto.randomBytes(6).toString("hex").toUpperCase();
}

/*
 * GET /api/payments/mine
 * Returns payment history for the logged-in buyer.
 */
router.get("/mine", requireBuyer, async (req, res) => {
    try {
        const [payments] = await pool.query(
            `SELECT
                payment_id AS paymentId,
                order_id AS orderId,
                amount,
                payment_method AS paymentMethod,
                transaction_reference AS transactionReference,
                payment_status AS status,
                created_at AS createdAt,
                paid_at AS paidAt
             FROM payments
             WHERE buyer_id = ?
             ORDER BY payment_id DESC`,
            [req.session.user.userId]
        );

        res.json({ payments });
    } catch (error) {
        console.error("Load payments error:", error);

        res.status(500).json({
            message: "Unable to load payment history. Check the server logs."
        });
    }
});

/*
 * GET /api/payments/orders
 * Returns accepted or completed orders and their outstanding balances.
 */
router.get("/orders", requireBuyer, async (req, res) => {
    try {
        const [orders] = await pool.query(
            `SELECT
                o.order_id AS orderId,
                o.total_price AS totalPrice,
                o.status AS orderStatus,
                p.product_name AS productName
             FROM farmer_orders o
             INNER JOIN products p
                ON p.product_id = o.product_id
             WHERE o.buyer_id = ?
               AND o.status IN ('accepted', 'completed')
             ORDER BY o.order_id DESC`,
            [req.session.user.userId]
        );

        const [paidRows] = await pool.query(
            `SELECT
                order_id AS orderId,
                COALESCE(SUM(amount), 0) AS amountPaid
             FROM payments
             WHERE buyer_id = ?
               AND payment_status = 'successful'
             GROUP BY order_id`,
            [req.session.user.userId]
        );

        const paidByOrder = new Map(
            paidRows.map(row => [
                Number(row.orderId),
                Number(row.amountPaid || 0)
            ])
        );

        res.json({
            orders: orders.map(order => {
                const totalPrice = Number(order.totalPrice || 0);
                const amountPaid =
                    paidByOrder.get(Number(order.orderId)) || 0;

                return {
                    ...order,
                    totalPrice,
                    amountPaid,
                    balance: Math.max(0, totalPrice - amountPaid)
                };
            })
        });
    } catch (error) {
        console.error("Load payable orders error:", error);

        res.status(500).json({
            message: "Unable to load payable orders. Check the server logs."
        });
    }
});

/*
 * POST /api/payments
 * Creates a pending TEST payment request.
 * No real mobile-money transaction is initiated.
 *
 * Body: { orderId, paymentMethod, phone }
 */
router.post("/", requireBuyer, async (req, res) => {
    const orderId = Number(req.body.orderId);
    const paymentMethod = String(
        req.body.paymentMethod || ""
    ).toLowerCase();
    const phone = String(req.body.phone || "").trim();

    if (!Number.isSafeInteger(orderId) || orderId < 1) {
        return res.status(400).json({
            message: "Select a valid order."
        });
    }

    if (!METHODS.includes(paymentMethod)) {
        return res.status(400).json({
            message: "Choose MTN MoMo or Airtel Money."
        });
    }

    if (!/^\+?[0-9]{9,15}$/.test(phone)) {
        return res.status(400).json({
            message: "Enter a valid mobile-money phone number."
        });
    }

    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [orders] = await connection.query(
            `SELECT
                order_id,
                buyer_id,
                farmer_id,
                total_price,
                status
             FROM farmer_orders
             WHERE order_id = ?
               AND buyer_id = ?
             FOR UPDATE`,
            [orderId, req.session.user.userId]
        );

        if (!orders.length) {
            await connection.rollback();

            return res.status(404).json({
                message: "Order not found for your account."
            });
        }

        const order = orders[0];

        if (!["accepted", "completed"].includes(order.status)) {
            await connection.rollback();

            return res.status(400).json({
                message: "The farmer must accept the order before payment."
            });
        }

        const [paidRows] = await connection.query(
            `SELECT COALESCE(SUM(amount), 0) AS amountPaid
             FROM payments
             WHERE order_id = ?
               AND buyer_id = ?
               AND payment_status = 'successful'`,
            [orderId, req.session.user.userId]
        );

        const totalPrice = Number(order.total_price);
        const amountPaid = Number(paidRows[0].amountPaid || 0);
        const balance = Math.max(0, totalPrice - amountPaid);

        if (balance <= 0) {
            await connection.rollback();

            return res.status(400).json({
                message: "This order is already fully paid."
            });
        }

        const transactionReference = createReference();

        const [result] = await connection.query(
            `INSERT INTO payments (
                order_id,
                buyer_id,
                farmer_id,
                amount,
                payment_method,
                transaction_reference,
                payment_status,
                created_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending', NOW())`,
            [
                orderId,
                req.session.user.userId,
                order.farmer_id,
                balance.toFixed(2),
                paymentMethod,
                transactionReference
            ]
        );

        await connection.commit();

        res.status(201).json({
            message:
                "Test payment request created. No money has been transferred.",
            payment: {
                paymentId: result.insertId,
                orderId,
                amount: balance,
                paymentMethod,
                phone,
                transactionReference,
                status: "pending",
                testMode: true
            }
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Payment rollback error:", rollbackError);
            }
        }

        console.error("Create payment error:", error);

        res.status(500).json({
            message: "Could not create the test payment request."
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

/*
 * POST /api/payments/:id/simulate
 * TESTING ONLY. Never use this endpoint to verify real payments.
 */
router.post("/:id/simulate", requireBuyer, async (req, res) => {
    const paymentId = Number(req.params.id);
    const outcome = String(req.body.outcome || "").toLowerCase();

    if (!Number.isSafeInteger(paymentId) || paymentId < 1) {
        return res.status(400).json({
            message: "Invalid payment ID."
        });
    }

    if (!TEST_OUTCOMES.includes(outcome)) {
        return res.status(400).json({
            message: "Choose successful or failed for testing."
        });
    }

    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.query(
            `SELECT
                payment_id,
                order_id,
                amount,
                payment_status
             FROM payments
             WHERE payment_id = ?
               AND buyer_id = ?
             FOR UPDATE`,
            [paymentId, req.session.user.userId]
        );

        if (!rows.length) {
            await connection.rollback();

            return res.status(404).json({
                message: "Payment not found."
            });
        }

        const payment = rows[0];

        if (payment.payment_status !== "pending") {
            await connection.rollback();

            return res.status(409).json({
                message: "Only pending test payments can be updated."
            });
        }

        if (outcome === "successful") {
            const [paidRows] = await connection.query(
                `SELECT COALESCE(SUM(amount), 0) AS amountPaid
                 FROM payments
                 WHERE order_id = ?
                   AND buyer_id = ?
                   AND payment_status = 'successful'`,
                [payment.order_id, req.session.user.userId]
            );

            const [orderRows] = await connection.query(
                `SELECT total_price
                 FROM farmer_orders
                 WHERE order_id = ?
                   AND buyer_id = ?
                 FOR UPDATE`,
                [payment.order_id, req.session.user.userId]
            );

            if (!orderRows.length) {
                await connection.rollback();

                return res.status(404).json({
                    message: "The associated order was not found."
                });
            }

            const amountAlreadyPaid = Number(
                paidRows[0].amountPaid || 0
            );
            const orderTotal = Number(orderRows[0].total_price);
            const newPaymentAmount = Number(payment.amount);

            if (
                amountAlreadyPaid + newPaymentAmount >
                orderTotal + 0.001
            ) {
                await connection.rollback();

                return res.status(400).json({
                    message: "This test result would overpay the order."
                });
            }
        }

        await connection.query(
            `UPDATE payments
             SET payment_status = ?,
                 paid_at = CASE
                     WHEN ? = 'successful' THEN NOW()
                     ELSE paid_at
                 END
             WHERE payment_id = ?
               AND buyer_id = ?`,
            [
                outcome,
                outcome,
                paymentId,
                req.session.user.userId
            ]
        );

        await connection.commit();

        res.json({
            message:
                `TEST ONLY: payment marked ${outcome}. ` +
                "This does not verify a real money transfer.",
            paymentId,
            status: outcome,
            testMode: true
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Simulation rollback error:", rollbackError);
            }
        }

        console.error("Simulate payment error:", error);

        res.status(500).json({
            message: "Unable to update the test payment."
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

/*
 * GET /api/payments/:id
 * Returns a payment belonging to the logged-in buyer.
 */
router.get("/:id", requireLogin, async (req, res) => {
    const paymentId = Number(req.params.id);

    if (!Number.isSafeInteger(paymentId) || paymentId < 1) {
        return res.status(400).json({
            message: "Invalid payment ID."
        });
    }

    try {
        const [rows] = await pool.query(
            `SELECT
                payment_id AS paymentId,
                order_id AS orderId,
                buyer_id AS buyerId,
                amount,
                payment_method AS paymentMethod,
                transaction_reference AS transactionReference,
                payment_status AS status,
                created_at AS createdAt,
                paid_at AS paidAt
             FROM payments
             WHERE payment_id = ?
               AND buyer_id = ?`,
            [paymentId, req.session.user.userId]
        );

        if (!rows.length) {
            return res.status(404).json({
                message: "Payment not found."
            });
        }

        res.json({ payment: rows[0] });
    } catch (error) {
        console.error("Get payment error:", error);

        res.status(500).json({
            message: "Unable to load payment details."
        });
    }
});

module.exports = router;
