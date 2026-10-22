
"use strict";

const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

/*
 * Require a logged-in buyer.
 * req.session.user is populated by your existing auth routes.
 */
router.use((req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.status(401).json({
            message: "Please log in to continue."
        });
    }

    if (String(req.session.user.role).toLowerCase() !== "buyer") {
        return res.status(403).json({
            message: "Access denied. A buyer account is required."
        });
    }

    next();
});

/*
 * GET /api/buyer/products
 * Return products that buyers can browse.
 */
router.get("/products", async (req, res) => {
    try {
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
                u.full_name AS farmer_name,
                u.location AS farmer_location
            FROM products p
            INNER JOIN users u
                ON u.user_id = p.farmer_id
            WHERE LOWER(p.status) = 'available'
              AND p.quantity > 0
              AND u.is_active = 1
              AND LOWER(u.role) = 'farmer'
            ORDER BY p.created_at DESC, p.product_id DESC
        `);

        return res.json({
            products
        });
    } catch (error) {
        console.error("Buyer products error:", error);

        return res.status(500).json({
            message: "Unable to load marketplace products."
        });
    }
});

/*
 * GET /api/buyer/orders
 * Return only orders belonging to the logged-in buyer.
 */
router.get("/orders", async (req, res) => {
    try {
        const buyerId = req.session.user.userId;

        const [orders] = await pool.query(`
            SELECT
                o.order_id,
                o.buyer_id,
                o.farmer_id,
                o.product_id,
                o.quantity,
                o.total_price,
                o.status,
                o.created_at,
                p.product_name,
                p.unit,
                farmer.full_name AS farmer_name
            FROM farmer_orders o
            LEFT JOIN products p
                ON p.product_id = o.product_id
            LEFT JOIN users farmer
                ON farmer.user_id = o.farmer_id
            WHERE o.buyer_id = ?
            ORDER BY o.created_at DESC, o.order_id DESC
        `, [buyerId]);

        return res.json({
            orders
        });
    } catch (error) {
        console.error("Buyer orders error:", error);

        return res.status(500).json({
            message: "Unable to load your orders."
        });
    }
});

/*
 * POST /api/buyer/orders
 * Create an order for an available product.
 *
 * Expected JSON:
 * {
 *   "productId": 1,
 *   "quantity": 2
 * }
 */
router.post("/orders", async (req, res) => {
    const buyerId = req.session.user.userId;
    const productId = Number(req.body?.productId);
    const quantity = Number(req.body?.quantity);

    if (
        !Number.isSafeInteger(productId) ||
        productId < 1
    ) {
        return res.status(400).json({
            message: "Please select a valid product."
        });
    }

    if (
        !Number.isSafeInteger(quantity) ||
        quantity < 1
    ) {
        return res.status(400).json({
            message: "Quantity must be a positive whole number."
        });
    }

    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        /*
         * Lock the product row while validating and creating
         * the order to reduce concurrent stock over-ordering.
         */
        const [products] = await connection.query(`
            SELECT
                product_id,
                farmer_id,
                product_name,
                price,
                quantity,
                unit,
                status
            FROM products
            WHERE product_id = ?
            FOR UPDATE
        `, [productId]);

        if (products.length === 0) {
            await connection.rollback();

            return res.status(404).json({
                message: "The selected product was not found."
            });
        }

        const product = products[0];

        if (String(product.status).toLowerCase() !== "available") {
            await connection.rollback();

            return res.status(409).json({
                message: "This product is currently unavailable."
            });
        }

        if (Number(product.quantity) < quantity) {
            await connection.rollback();

            return res.status(409).json({
                message: `Insufficient stock. Only ${product.quantity} ${product.unit || "units"} are available.`
            });
        }

        if (Number(product.farmer_id) === Number(buyerId)) {
            await connection.rollback();

            return res.status(400).json({
                message: "You cannot order your own product."
            });
        }

        const totalPrice = Number(
            (Number(product.price) * quantity).toFixed(2)
        );

        if (!Number.isFinite(totalPrice) || totalPrice <= 0) {
            await connection.rollback();

            return res.status(400).json({
                message: "The product has an invalid price."
            });
        }

        /*
         * New orders start as pending for farmer confirmation.
         * Stock is not deducted in this version.
         */
        const [result] = await connection.query(`
            INSERT INTO farmer_orders (
                buyer_id,
                farmer_id,
                product_id,
                quantity,
                total_price,
                status
            )
            VALUES (?, ?, ?, ?, ?, 'pending')
        `, [
            buyerId,
            product.farmer_id,
            product.product_id,
            quantity,
            totalPrice
        ]);

        await connection.commit();

        return res.status(201).json({
            message: "Order placed successfully. Await farmer confirmation.",
            order: {
                orderId: result.insertId,
                productId: product.product_id,
                productName: product.product_name,
                quantity,
                unit: product.unit,
                totalPrice,
                status: "pending"
            }
        });
    } catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            } catch (rollbackError) {
                console.error("Order rollback error:", rollbackError);
            }
        }

        console.error("Create buyer order error:", error);

        return res.status(500).json({
            message: "Unable to place your order. Please try again."
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

module.exports = router;
