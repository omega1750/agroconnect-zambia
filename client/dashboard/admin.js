
"use strict";

const API_BASE = "/api/admin";
const $ = (id) => document.getElementById(id);

let adminUser = null;
let usersCache = [];
let productsCache = [];
let overviewData = {};
let overviewChart = null;
let ordersChart = null;

const escapeHTML = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;"
    })[char]);

const number = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString() : "0";
};

const money = (value) => {
    const n = Number(value);
    return Number.isFinite(n)
        ? "K" + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        : "—";
};

function setMessage(message, type = "error") {
    const el = $("dashboardMessage");
    if (!el) return;
    el.textContent = message;
    el.className = "alert-message " + (type === "success" ? "alert-success" : "alert-error");
    el.hidden = false;
}

function clearMessage() {
    const el = $("dashboardMessage");
    if (el) el.hidden = true;
}

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
        window.location.href = "/login/login.html";
        throw new Error("Your session has expired. Please log in again.");
    }

    if (response.status === 403) {
        throw new Error(data.message || "Administrator access is required.");
    }

    if (!response.ok) {
        throw new Error(data.message || `Request failed (${response.status}).`);
    }

    return data;
}

function listFrom(data, key) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.[key])) return data[key];
    return [];
}

function valueFrom(source, keys, fallback = 0) {
    for (const key of keys) {
        if (source && source[key] !== undefined && source[key] !== null) {
            return source[key];
        }
    }
    return fallback;
}

function roleBadge(role) {
    const safeRole = String(role || "unknown").toLowerCase();
    const allowed = ["farmer", "buyer", "admin"];
    const cls = allowed.includes(safeRole) ? safeRole : "neutral";
    return `<span class="badge badge-${cls}">${escapeHTML(safeRole)}</span>`;
}

function statusBadge(active) {
    const isActive = active === true || Number(active) === 1;
    return `<span class="badge ${isActive ? "badge-active" : "badge-inactive"}">${isActive ? "Active" : "Inactive"}</span>`;
}

function productBadge(status) {
    const safe = String(status || "unknown").toLowerCase();
    const known = ["available", "sold_out", "pending", "completed", "cancelled"];
    return `<span class="badge ${known.includes(safe) ? "badge-" + safe : "badge-neutral"}">${escapeHTML(safe.replaceAll("_", " "))}</span>`;
}

function displayName(user) {
    return user.full_name || user.fullName || user.name || "Unnamed user";
}

function displayRole(user) {
    return String(user.role || "unknown").toLowerCase();
}

function displayActive(user) {
    return user.is_active ?? user.isActive ?? 1;
}

async function loadAdminIdentity() {
    const data = await api("/api/auth/me");
    adminUser = data.user || data;

    const role = String(adminUser.role || "").toLowerCase();
    if (role !== "admin") {
        window.location.href = "/registration/register.html";
        throw new Error("This page is restricted to administrators.");
    }

    const name = adminUser.fullName || adminUser.full_name ||
        adminUser.name || adminUser.email || "Administrator";

    $("adminName").textContent = name;
    $("welcomeName").textContent = name.split(" ")[0];
    $("adminAvatar").textContent = name.charAt(0).toUpperCase();
}

async function loadOverview() {
    const data = await api(`${API_BASE}/overview`);
    overviewData = data.overview || data.stats || data;

    const users = overviewData.users || {};
    const products = overviewData.products || {};
    const orders = overviewData.orders || {};

    $("totalUsers").textContent = number(valueFrom(overviewData, ["totalUsers", "total_users"], valueFrom(users, ["total", "totalUsers", "total_users"])));
    $("totalFarmers").textContent = number(valueFrom(overviewData, ["totalFarmers", "total_farmers"], valueFrom(users, ["farmers", "totalFarmers", "total_farmers"])));
    $("totalBuyers").textContent = number(valueFrom(overviewData, ["totalBuyers", "total_buyers"], valueFrom(users, ["buyers", "totalBuyers", "total_buyers"])));
    $("totalProducts").textContent = number(valueFrom(overviewData, ["totalProducts", "total_products"], valueFrom(products, ["total", "totalProducts", "total_products"])));
    $("availableProducts").textContent = number(valueFrom(overviewData, ["availableProducts", "available_products"], valueFrom(products, ["available", "availableProducts", "available_products"])));
    $("totalOrders").textContent = number(valueFrom(overviewData, ["totalOrders", "total_orders"], valueFrom(orders, ["total", "totalOrders", "total_orders"])));

    $("ordersAll").textContent = number(valueFrom(orders, ["total", "totalOrders", "total_orders"], $("totalOrders").textContent.replaceAll(",", "")));
    $("ordersPending").textContent = number(valueFrom(orders, ["pending", "pendingOrders", "pending_orders"]));
    $("ordersCompleted").textContent = number(valueFrom(orders, ["completed", "completedOrders", "completed_orders"]));
    $("ordersCancelled").textContent = number(
        Number(valueFrom(orders, ["cancelled", "cancelledOrders", "cancelled_orders"])) +
        Number(valueFrom(orders, ["rejected", "rejectedOrders", "rejected_orders"]))
    );

    renderOverviewCharts();
    renderOrderSummary(orders);
}

function renderOverviewCharts() {
    if (typeof Chart === "undefined") return;

    const ctx = $("overviewChart");
    if (ctx) {
        if (overviewChart) overviewChart.destroy();

        overviewChart = new Chart(ctx, {
            type: "bar",
            data: {
                labels: ["Users", "Farmers", "Buyers", "Products", "Available", "Orders"],
                datasets: [{
                    label: "Current total",
                    data: [
                        Number($("totalUsers").textContent.replaceAll(",", "")) || 0,
                        Number($("totalFarmers").textContent.replaceAll(",", "")) || 0,
                        Number($("totalBuyers").textContent.replaceAll(",", "")) || 0,
                        Number($("totalProducts").textContent.replaceAll(",", "")) || 0,
                        Number($("availableProducts").textContent.replaceAll(",", "")) || 0,
                        Number($("totalOrders").textContent.replaceAll(",", "")) || 0
                    ],
                    backgroundColor: ["#31945e", "#4b91d1", "#9671d9", "#e8a052", "#30a996", "#d66d65"],
                    borderRadius: 6,
                    maxBarThickness: 38
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { grid: { display: false }, ticks: { font: { size: 10 } } },
                    y: { beginAtZero: true, ticks: { precision: 0 }, grid: { color: "#edf1ed" } }
                }
            }
        });
    }

    const orderData = overviewData.orders || {};
    const labels = ["Pending", "Accepted", "Completed", "Rejected", "Cancelled"];
    const keys = [
        ["pending", "pendingOrders", "pending_orders"],
        ["accepted", "acceptedOrders", "accepted_orders"],
        ["completed", "completedOrders", "completed_orders"],
        ["rejected", "rejectedOrders", "rejected_orders"],
        ["cancelled", "cancelledOrders", "cancelled_orders"]
    ];
    const values = keys.map((group) => Number(valueFrom(orderData, group)) || 0);
    const colors = ["#e7ad47", "#4d92d4", "#36a56b", "#d87870", "#9671d9"];

    const orderCanvas = $("ordersChart");
    if (orderCanvas) {
        if (ordersChart) ordersChart.destroy();

        ordersChart = new Chart(orderCanvas, {
            type: "doughnut",
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderWidth: 3,
                    borderColor: "#fff",
                    hoverOffset: 5
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: "68%",
                plugins: { legend: { display: false } }
            }
        });
    }

    $("orderLegend").innerHTML = labels.map((label, i) =>
        `<span class="legend-item"><span class="legend-dot" style="background:${colors[i]}"></span>${escapeHTML(label)}: ${number(values[i])}</span>`
    ).join("");
}

function renderOrderSummary(orders) {
    const entries = [
        ["Pending", ["pending", "pendingOrders", "pending_orders"]],
        ["Accepted", ["accepted", "acceptedOrders", "accepted_orders"]],
        ["Completed", ["completed", "completedOrders", "completed_orders"]],
        ["Rejected", ["rejected", "rejectedOrders", "rejected_orders"]],
        ["Cancelled", ["cancelled", "cancelledOrders", "cancelled_orders"]]
    ];

    $("orderSummary").innerHTML = entries.map(([label, keys]) =>
        `<div class="order-summary-item"><span>${escapeHTML(label)}</span><strong>${number(valueFrom(orders, keys))}</strong></div>`
    ).join("");
}

async function loadUsers(search = "", role = "") {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (role) params.set("role", role);

    const data = await api(`${API_BASE}/users?${params}`);
    usersCache = listFrom(data, "users");

    renderUsersTable(usersCache);
    renderRoleTables(usersCache);
    renderRecentUsers(usersCache);
}

function renderUsersTable(users) {
    const body = $("usersTableBody");
    if (!users.length) {
        body.innerHTML = '<tr><td colspan="7" class="empty-cell">No users found.</td></tr>';
        return;
    }

    body.innerHTML = users.map((user) => {
        const id = user.user_id ?? user.userId;
        const active = displayActive(user);
        const isSelf = adminUser && String(id) === String(adminUser.userId ?? adminUser.user_id);

        return `<tr>
            <td><div class="user-cell"><span class="mini-avatar">${escapeHTML(displayName(user).charAt(0).toUpperCase())}</span>
                <div><strong>${escapeHTML(displayName(user))}</strong><small>${escapeHTML(user.email || "")}</small></div></div></td>
            <td>${escapeHTML(user.phone || "—")}</td>
            <td>${escapeHTML(user.location || "—")}</td>
            <td>${roleBadge(displayRole(user))}</td>
            <td>${escapeHTML(formatDate(user.created_at || user.createdAt))}</td>
            <td>${statusBadge(active)}</td>
            <td>${isSelf ? '<span class="muted">Current account</span>' :
                `<button class="action-button ${Number(active) === 1 || active === true ? "danger" : ""}"
                    data-user-action="${escapeHTML(id)}"
                    data-active="${Number(active) === 1 || active === true ? "1" : "0"}">
                    ${Number(active) === 1 || active === true ? "Deactivate" : "Activate"}
                </button>`}</td>
        </tr>`;
    }).join("");
}

function renderRoleTables(users) {
    for (const role of ["farmers", "buyers"]) {
        const wanted = role === "farmers" ? "farmer" : "buyer";
        const body = $(role + "TableBody");
        if (!body) continue;

        const filtered = users.filter((u) => displayRole(u) === wanted);
        if (!filtered.length) {
            body.innerHTML = `<tr><td colspan="5" class="empty-cell">No ${role} found.</td></tr>`;
            continue;
        }

        body.innerHTML = filtered.map((u) => `
            <tr>
                <td>${escapeHTML(displayName(u))}</td>
                <td>${escapeHTML(u.email || "—")}</td>
                <td>${escapeHTML(u.phone || "—")}</td>
                <td>${escapeHTML(u.location || "—")}</td>
                <td>${statusBadge(displayActive(u))}</td>
            </tr>`).join("");
    }
}

function renderRecentUsers(users) {
    const body = $("recentUsersBody");
    const recent = [...users].sort((a, b) =>
        new Date(b.created_at || b.createdAt || 0) - new Date(a.created_at || a.createdAt || 0)
    ).slice(0, 5);

    if (!recent.length) {
        body.innerHTML = '<tr><td colspan="3" class="empty-cell">No users found.</td></tr>';
        return;
    }

    body.innerHTML = recent.map((u) => `
        <tr>
            <td><div class="user-cell"><span class="mini-avatar">${escapeHTML(displayName(u).charAt(0).toUpperCase())}</span>
            <div><strong>${escapeHTML(displayName(u))}</strong><small>${escapeHTML(u.email || "")}</small></div></div></td>
            <td>${roleBadge(displayRole(u))}</td>
            <td>${statusBadge(displayActive(u))}</td>
        </tr>`).join("");
}

async function loadProducts(search = "") {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());

    const data = await api(`${API_BASE}/products?${params}`);
    productsCache = listFrom(data, "products");
    renderProductsTable(productsCache);
    renderRecentProducts(productsCache);
}

function renderProductsTable(products) {
    const body = $("productsTableBody");
    if (!products.length) {
        body.innerHTML = '<tr><td colspan="6" class="empty-cell">No products found.</td></tr>';
        return;
    }

    body.innerHTML = products.map((p) => `
        <tr>
            <td><div class="product-cell"><strong>${escapeHTML(p.product_name || p.productName || "Unnamed product")}</strong>
            <small>${escapeHTML(p.description || "")}</small></div></td>
            <td>${escapeHTML(p.farmer_name || p.farmerName || "—")}</td>
            <td>${money(p.price)}</td>
            <td>${number(p.quantity)}</td>
            <td>${escapeHTML(p.unit || "—")}</td>
            <td>${productBadge(p.status)}</td>
        </tr>`).join("");
}

function renderRecentProducts(products) {
    const body = $("recentProductsBody");
    const recent = products.slice(0, 5);

    if (!recent.length) {
        body.innerHTML = '<tr><td colspan="3" class="empty-cell">No products found.</td></tr>';
        return;
    }

    body.innerHTML = recent.map((p) => `
        <tr>
            <td><div class="product-cell"><strong>${escapeHTML(p.product_name || p.productName || "Unnamed product")}</strong>
                <small>${productBadge(p.status)}</small></div></td>
            <td>${escapeHTML(p.farmer_name || p.farmerName || "—")}</td>
            <td>${money(p.price)}</td>
        </tr>`).join("");
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime())
        ? "—"
        : date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}

async function refreshDashboard() {
    clearMessage();
    $("refreshBtn").disabled = true;
    $("refreshBtn").textContent = "Refreshing...";

    try {
        await Promise.all([
            loadOverview(),
            loadUsers($("userSearch")?.value || "", $("userRoleFilter")?.value || ""),
            loadProducts($("productSearch")?.value || "")
        ]);
    } catch (error) {
        setMessage(error.message || "Unable to load dashboard data.");
    } finally {
        $("refreshBtn").disabled = false;
        $("refreshBtn").textContent = "↻ Refresh data";
    }
}

function showSection(name) {
    const valid = ["overview", "users", "farmers", "buyers", "products", "orders", "payments"];
    if (!valid.includes(name)) name = "overview";

    document.querySelectorAll(".dashboard-section").forEach((section) => {
        section.hidden = section.id !== name + "Section";
    });

    document.querySelectorAll(".nav-link").forEach((link) => {
        link.classList.toggle("active", link.dataset.section === name);
    });

    $("sidebar").classList.remove("open");
    window.location.hash = name;

    if (name === "users") loadUsers($("userSearch").value, $("userRoleFilter").value).catch((e) => setMessage(e.message));
    if (name === "farmers" || name === "buyers") {
        loadUsers().catch((e) => setMessage(e.message));
    }
    if (name === "products") loadProducts($("productSearch").value).catch((e) => setMessage(e.message));
}

async function changeUserStatus(id, active) {
    const action = active ? "deactivate" : "activate";
    if (!window.confirm(`Are you sure you want to ${action} this account?`)) return;

    try {
        await api(`${API_BASE}/users/${encodeURIComponent(id)}/status`, {
            method: "PATCH",
            body: JSON.stringify({ is_active: active ? 0 : 1 })
        });
        setMessage(`User account ${active ? "deactivated" : "activated"} successfully.`, "success");
        await Promise.all([loadUsers($("userSearch").value, $("userRoleFilter").value), loadOverview()]);
    } catch (error) {
        setMessage(error.message || "Unable to update the user account.");
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    $("currentYear").textContent = new Date().getFullYear();

    document.querySelectorAll(".nav-link").forEach((link) => {
        link.addEventListener("click", (event) => {
            event.preventDefault();
            showSection(link.dataset.section);
        });
    });

    document.querySelectorAll("[data-go]").forEach((button) => {
        button.addEventListener("click", () => showSection(button.dataset.go));
    });

    $("menuToggle").addEventListener("click", () => $("sidebar").classList.toggle("open"));
    $("refreshBtn").addEventListener("click", refreshDashboard);

    $("searchUsersBtn").addEventListener("click", () =>
        loadUsers($("userSearch").value, $("userRoleFilter").value).catch((e) => setMessage(e.message))
    );
    $("userRoleFilter").addEventListener("change", () =>
        loadUsers($("userSearch").value, $("userRoleFilter").value).catch((e) => setMessage(e.message))
    );
    $("searchFarmersBtn").addEventListener("click", () =>
        loadUsers($("farmersSearch").value, "farmer").catch((e) => setMessage(e.message))
    );
    $("searchBuyersBtn").addEventListener("click", () =>
        loadUsers($("buyersSearch").value, "buyer").catch((e) => setMessage(e.message))
    );
    $("searchProductsBtn").addEventListener("click", () =>
        loadProducts($("productSearch").value).catch((e) => setMessage(e.message))
    );

    $("userSearch").addEventListener("keydown", (e) => {
        if (e.key === "Enter") $("searchUsersBtn").click();
    });
    $("productSearch").addEventListener("keydown", (e) => {
        if (e.key === "Enter") $("searchProductsBtn").click();
    });

    $("usersTableBody").addEventListener("click", (event) => {
        const button = event.target.closest("[data-user-action]");
        if (!button) return;
        changeUserStatus(button.dataset.userAction, button.dataset.active === "1");
    });

    $("logoutBtn").addEventListener("click", async () => {
        if (!window.confirm("Are you sure you want to sign out?")) return;
        try {
            await api("/api/auth/logout", { method: "POST" });
        } catch (error) {
            console.warn("Logout request:", error.message);
        }
        window.location.href = "/login/login.html";
    });

    try {
        await loadAdminIdentity();
        await refreshDashboard();
        const section = window.location.hash.replace("#", "");
        if (section) showSection(section);
    } catch (error) {
        setMessage(error.message || "Unable to initialise the dashboard.");
    }
});
