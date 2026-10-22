
"use strict";

const express = require("express");
const pool = require("../db/pool");

const router = express.Router();

const ORDER_STATUSES = ["accepted", "rejected", "completed"];

function getUserId(req) {
    return req.session?.user?.userId ??
        req.session?.user?.user_id ?? null;
}

function requireFarmer(req, res, next) {
    if (!req.session?.user) {
        return res.status(401).json({ message: "Please log in to continue." });
    }

    if (req.session.user.role !== "farmer") {
        return res.status(403).json({ message: "Farmer access only." });
    }

    if (!getUserId(req)) {
        return res.status(401).json({
            message: "Your session is invalid. Please log in again."
        });
    }

    next();
}

router.use(requireFarmer);

function positiveNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}

function normalizeProduct(body) {
    const productName = String(body.productName ?? body.product_name ?? "").trim();
    const description = String(body.description ?? "").trim();
    const price = positiveNumber(body.price);
    const quantity = positiveNumber(body.quantity);
    const unit = String(body.unit || "kg").trim().toLowerCase();
    const imageUrl = String(body.imageUrl ?? body.image_url ?? "").trim();

    const allowedUnits = [
        "kg", "g", "tonne", "bag", "piece", "crate", "litre", "bunch"
    ];

    if (!productName || productName.length > 150) {
        return { error: "Enter a product name (maximum 150 characters)." };
    }
    if (!price || !quantity) {
        return { error: "Price and quantity must be greater than zero." };
    }
    if (!allowedUnits.includes(unit)) {
        return { error: "Choose a valid product unit." };
    }
    if (description.length > 2000) {
        return { error: "Description is too long." };
    }
    if (imageUrl && !/^https?:\/\/\S+$/i.test(imageUrl)) {
        return { error: "Image URL must start with http:// or https://." };
    }

    return {
        data: {
            productName, description, price, quantity, unit,
            imageUrl: imageUrl || null
        }
    };
}

/* GET /api/farmer/overview */
router.get("/overview", async (req, res) => {
    try {
        const farmerId = getUserId(req);

        const [[products]] = await pool.query(
            `SELECT
                COUNT(*) AS totalProducts,
                COALESCE(SUM(status = 'available' AND quantity > 0), 0) AS availableProducts,
                COALESCE(SUM(quantity), 0) AS totalStock
             FROM products
             WHERE farmer_id = ?`,
            [farmerId]
        );

        const [[orders]] = await pool.query(
            `SELECT
                COUNT(*) AS totalOrders,
                COALESCE(SUM(status = 'pending'), 0) AS pendingOrders,
                COALESCE(SUM(status = 'accepted'), 0) AS acceptedOrders,
                COALESCE(SUM(status = 'completed'), 0) AS completedOrders,
                COALESCE(SUM(status = 'rejected'), 0) AS rejectedOrders,
                COALESCE(SUM(total_price), 0) AS totalOrderValue,
                COALESCE(SUM(CASE WHEN status = 'accepted' THEN total_price ELSE 0 END), 0) AS acceptedOrderValue
             FROM farmer_orders
             WHERE farmer_id = ?`,
            [farmerId]
        );

        res.json({
            products: {
                total: Number(products.totalProducts),
                available: Number(products.availableProducts),
                totalStock: Number(products.totalStock)
            },
            orders: {
                total: Number(orders.totalOrders),
                pending: Number(orders.pendingOrders),
                accepted: Number(orders.acceptedOrders),
                completed: Number(orders.completedOrders),
                rejected: Number(orders.rejectedOrders),
                totalOrderValue: Number(orders.totalOrderValue),
                acceptedOrderValue: Number(orders.acceptedOrderValue)
            }
        });
    } catch (error) {
        console.error("Farmer overview error:", error);
        res.status(500).json({ message: "Unable to load dashboard statistics." });
    }
});

/* GET /api/farmer/products */
router.get("/products", async (req, res) => {
    try {
        const [products] = await pool.query(
            `SELECT product_id AS productId, farmer_id AS farmerId,
                    product_name AS productName, description, price,
                    quantity, unit, image_url AS imageUrl, status
             FROM products
             WHERE farmer_id = ?
             ORDER BY product_id DESC`,
            [getUserId(req)]
        );
        res.json({ products });
    } catch (error) {
        console.error("List farmer products error:", error);
        res.status(500).json({ message: "Unable to load products." });
    }
});

/* POST /api/farmer/products */
router.post("/products", async (req, res) => {
    const result = normalizeProduct(req.body || {});
    if (result.error) return res.status(400).json({ message: result.error });

    try {
        const p = result.data;
        const [insert] = await pool.query(
            `INSERT INTO products
                (farmer_id, product_name, description, price, quantity, unit, image_url, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'available')`,
            [getUserId(req), p.productName, p.description || null,
                p.price, p.quantity, p.unit, p.imageUrl]
        );

        res.status(201).json({
            message: "Product added successfully.",
            productId: insert.insertId
        });
    } catch (error) {
        console.error("Add farmer product error:", error);
        res.status(500).json({ message: "Unable to add product." });
    }
});

/* PUT /api/farmer/products/:id */
router.put("/products/:id", async (req, res) => {
    const productId = Number(req.params.id);
    if (!Number.isSafeInteger(productId) || productId <= 0) {
        return res.status(400).json({ message: "Invalid product ID." });
    }

    const result = normalizeProduct(req.body || {});
    if (result.error) return res.status(400).json({ message: result.error });

    try {
        const p = result.data;
        const [update] = await pool.query(
            `UPDATE products
             SET product_name = ?, description = ?, price = ?, quantity = ?,
                 unit = ?, image_url = ?, status = ?
             WHERE product_id = ? AND farmer_id = ?`,
            [p.productName, p.description || null, p.price, p.quantity,
                p.unit, p.imageUrl, p.quantity > 0 ? "available" : "sold_out",
                productId, getUserId(req)]
        );

        if (!update.affectedRows) {
            return res.status(404).json({
                message: "Product not found or you do not own it."
            });
        }

        res.json({ message: "Product updated successfully." });
    } catch (error) {
        console.error("Update farmer product error:", error);
        res.status(500).json({ message: "Unable to update product." });
    }
});

/* DELETE /api/farmer/products/:id */
router.delete("/products/:id", async (req, res) => {
    const productId = Number(req.params.id);
    if (!Number.isSafeInteger(productId) || productId <= 0) {
        return res.status(400).json({ message: "Invalid product ID." });
    }

    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [products] = await connection.query(
            `SELECT product_id FROM products
             WHERE product_id = ? AND farmer_id = ? FOR UPDATE`,
            [productId, getUserId(req)]
        );

        if (!products.length) {
            await connection.rollback();
            return res.status(404).json({ message: "Product not found." });
        }

        const [orders] = await connection.query(
            "SELECT order_id FROM farmer_orders WHERE product_id = ? LIMIT 1",
            [productId]
        );

        if (orders.length) {
            await connection.rollback();
            return res.status(409).json({
                message: "This product has order history and cannot be deleted. Mark it sold out instead."
            });
        }

        await connection.query(
            "DELETE FROM products WHERE product_id = ? AND farmer_id = ?",
            [productId, getUserId(req)]
        );

        await connection.commit();
        res.json({ message: "Product deleted successfully." });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Delete farmer product error:", error);
        res.status(500).json({ message: "Unable to delete product." });
    } finally {
        if (connection) connection.release();
    }
});

/* GET /api/farmer/orders */
router.get("/orders", async (req, res) => {
    try {
        const [orders] = await pool.query(
            `SELECT
                o.order_id AS orderId, o.buyer_id AS buyerId,
                o.farmer_id AS farmerId, o.product_id AS productId,
                o.quantity, o.total_price AS totalPrice, o.status,
                p.product_name AS productName,
                u.full_name AS buyerName, u.phone AS buyerPhone,
                u.location AS buyerLocation
             FROM farmer_orders o
             LEFT JOIN products p ON p.product_id = o.product_id
             LEFT JOIN users u ON u.user_id = o.buyer_id
             WHERE o.farmer_id = ?
             ORDER BY o.order_id DESC`,
            [getUserId(req)]
        );
        res.json({ orders });
    } catch (error) {
        console.error("List farmer orders error:", error);
        res.status(500).json({ message: "Unable to load orders." });
    }
});

/* PATCH /api/farmer/orders/:id/status */
router.patch("/orders/:id/status", async (req, res) => {
    const orderId = Number(req.params.id);
    const status = String(req.body?.status || "").toLowerCase();

    if (!Number.isSafeInteger(orderId) || orderId <= 0) {
        return res.status(400).json({ message: "Invalid order ID." });
    }
    if (!ORDER_STATUSES.includes(status)) {
        return res.status(400).json({
            message: "Status must be accepted, rejected, or completed."
        });
    }

    let connection;

    try {
        connection = await pool.getConnection();
        await connection.beginTransaction();

        const [rows] = await connection.query(
            `SELECT order_id, status FROM farmer_orders
             WHERE order_id = ? AND farmer_id = ? FOR UPDATE`,
            [orderId, getUserId(req)]
        );

        if (!rows.length) {
            await connection.rollback();
            return res.status(404).json({ message: "Order not found." });
        }

        const currentStatus = rows[0].status;
        const transitions = {
            pending: ["accepted", "rejected"],
            accepted: ["completed"],
            rejected: [],
            completed: []
        };

        if (!(transitions[currentStatus] || []).includes(status)) {
            await connection.rollback();
            return res.status(409).json({
                message: `Cannot change order from ${currentStatus} to ${status}.`
            });
        }

        await connection.query(
            `UPDATE farmer_orders SET status = ?
             WHERE order_id = ? AND farmer_id = ?`,
            [status, orderId, getUserId(req)]
        );

        await connection.commit();
        res.json({ message: "Order status updated.", status });
    } catch (error) {
        if (connection) await connection.rollback();
        console.error("Update order status error:", error);
        res.status(500).json({ message: "Unable to update order status." });
    } finally {
        if (connection) connection.release();
    }
});

module.exports = router;
