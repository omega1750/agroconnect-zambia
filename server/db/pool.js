require("dotenv").config();

const mysql = require("mysql2/promise");

let ssl;
if (process.env.DB_SSL === "true") {
    ssl = process.env.DB_CA
        ? { ca: process.env.DB_CA.replace(/\\n/g, "\n") }
        : { rejectUnauthorized: false };
}

const pool = mysql.createPool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT) || 3306,
    database: process.env.DB_NAME || "agroconnect_zambia",
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    ssl,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

module.exports = pool;