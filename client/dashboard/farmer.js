
"use strict";

const API = "/api";
const $ = id => document.getElementById(id);

const state = {
    user: null,
    products: [],
    orders: [],
    section: "overview",
    busy: false
};

const SECTION_TITLES = {
    overview: "Dashboard Overview",
    products: "My Products",
    "add-product": "Product Management",
    orders: "Customer Orders",
    account: "My Account"
};

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;"
    })[char]);
}

function money(value) {
    return "K" + Number(value || 0).toLocaleString("en-ZM", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function statusBadge(status) {
    const safe = String(status || "unknown").toLowerCase();
    return `<span class="status ${escapeHTML(safe)}">${escapeHTML(safe.replaceAll("_", " "))}</span>`;
}

function showNotice(message, isError = false) {
    const notice = $("notice");
    notice.textContent = message;
    notice.classList.toggle("error", isError);
    notice.hidden = false;

    if (showNotice.timer) clearTimeout(showNotice.timer);
    showNotice.timer = setTimeout(() => { notice.hidden = true; }, 5000);
}

async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });

    let data = {};
    try { data = await response.json(); } catch {}

    if (response.status === 401) {
        window.location.href = "/login/login.html";
        throw new Error("Please log in again.");
    }
    if (!response.ok) {
        throw new Error(data.message || `Request failed (${response.status}).`);
    }
    return data;
}

function switchSection(section) {
    if (!SECTION_TITLES[section]) return;
    state.section = section;

    document.querySelectorAll(".page-section").forEach(el => {
        el.classList.toggle("active", el.id === `section-${section}`);
    });
    document.querySelectorAll(".nav-link").forEach(el => {
        el.classList.toggle("active", el.dataset.section === section);
    });

    $("pageTitle").textContent = SECTION_TITLES[section];
    $("sidebar").classList.remove("open");
    $("mobileOverlay").classList.remove("visible");

    if (section === "add-product" && !$("editProductId").value) resetProductForm();
    if (section === "products") renderProducts();
    if (section === "orders") renderOrders();
}

function setAccount(user) {
    const name = user.fullName || user.full_name || "Farmer";
    const initial = name.trim().charAt(0).toUpperCase() || "F";

    $("farmerName").textContent = name;
    $("farmerEmail").textContent = user.email || "";
    $("welcomeName").textContent = name.split(" ")[0];
    $("avatar").textContent = initial;
    $("accountAvatar").textContent = initial;
    $("accountName").textContent = name;
    $("accountNameDetail").textContent = name;
    $("accountEmail").textContent = user.email || "Not provided";
    $("accountPhone").textContent = user.phone || "Not provided";
    $("accountLocation").textContent = user.location || "Not provided";
}

function countStatus(status) {
    return state.orders.filter(o => String(o.status).toLowerCase() === status).length;
}

function renderStats() {
    const products = state.products;
    const orders = state.orders;

    $("totalProducts").textContent = products.length;
    $("availableProducts").textContent = products.filter(
        p => p.status === "available" && Number(p.quantity) > 0
    ).length;
    $("totalOrders").textContent = orders.length;
    $("pendingOrders").textContent = countStatus("pending");
    $("acceptedOrders").textContent = countStatus("accepted");
    $("completedOrders").textContent = countStatus("completed");
    $("rejectedOrders").textContent = countStatus("rejected");

    const totalValue = orders.reduce(
        (sum, o) => sum + Number(o.totalPrice ?? o.total_price ?? 0), 0
    );
    $("totalOrderValue").textContent = money(totalValue);

    $("productNavCount").textContent = products.length;
    $("orderNavCount").textContent = orders.length;

    const statuses = ["pending", "accepted", "completed", "rejected"];
    statuses.forEach(status => {
        const count = countStatus(status);
        const percent = orders.length ? count / orders.length * 100 : 0;
        $(`${status}Bar`).style.width = `${percent}%`;
        $(`${status}Breakdown`).textContent = count;
    });
}

function renderRecentOrders() {
    const target = $("recentOrders");
    const recent = state.orders.slice(0, 5);

    if (!recent.length) {
        target.innerHTML = '<p class="empty-state">No customer orders yet.</p>';
        return;
    }

    target.innerHTML = `<table>
        <thead><tr><th>Order</th><th>Buyer</th><th>Product</th><th>Total</th><th>Status</th></tr></thead>
        <tbody>${recent.map(o => `<tr>
            <td>#${escapeHTML(o.orderId ?? o.order_id)}</td>
            <td>${escapeHTML(o.buyerName ?? o.buyer_name ?? "Buyer")}</td>
            <td>${escapeHTML(o.productName ?? o.product_name ?? "Product")}</td>
            <td>${money(o.totalPrice ?? o.total_price)}</td>
            <td>${statusBadge(o.status)}</td>
        </tr>`).join("")}</tbody>
    </table>`;
}

function productCard(p) {
    const id = p.productId ?? p.product_id;
    const name = p.productName ?? p.product_name ?? "Product";
    const image = p.imageUrl ?? p.image_url ?? "";
    const quantity = Number(p.quantity || 0);
    const unit = p.unit || "kg";

    return `<article class="product-card">
        <div class="product-image">${image
            ? `<img src="${escapeHTML(image)}" alt="${escapeHTML(name)}" loading="lazy" onerror="this.remove()">`
            : "🌾"}</div>
        <div class="product-card-body">
            <h3>${escapeHTML(name)}</h3>
            <div class="product-price">${money(p.price)} <small>/ ${escapeHTML(unit)}</small></div>
            <p>Stock: ${quantity.toLocaleString()} ${escapeHTML(unit)}</p>
            <p>${statusBadge(p.status)}</p>
            <div class="table-actions">
                <button class="action-button" data-action="edit-product" data-id="${escapeHTML(id)}">Edit</button>
                <button class="action-button danger" data-action="delete-product" data-id="${escapeHTML(id)}">Delete</button>
            </div>
        </div>
    </article>`;
}

function renderRecentProducts() {
    const target = $("recentProducts");
    const products = state.products.slice(0, 3);
    target.innerHTML = products.length
        ? products.map(productCard).join("")
        : '<p class="empty-state">You have not listed any products yet.</p>';
}

function renderProducts() {
    const query = $("productSearch").value.trim().toLowerCase();
    const status = $("productStatusFilter").value;

    const products = state.products.filter(p => {
        const name = String(p.productName ?? p.product_name ?? "").toLowerCase();
        const description = String(p.description || "").toLowerCase();
        return (name.includes(query) || description.includes(query)) &&
            (status === "all" || p.status === status);
    });

    const target = $("productsContainer");
    if (!products.length) {
        target.innerHTML = '<p class="empty-state">No products match your search.</p>';
        return;
    }

    target.innerHTML = `<table>
        <thead><tr><th>Product</th><th>Price</th><th>Stock</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${products.map(p => {
            const id = p.productId ?? p.product_id;
            const name = p.productName ?? p.product_name ?? "Product";
            return `<tr>
                <td><strong>${escapeHTML(name)}</strong><small>${escapeHTML(p.description || "")}</small></td>
                <td>${money(p.price)} / ${escapeHTML(p.unit || "kg")}</td>
                <td>${Number(p.quantity || 0).toLocaleString()} ${escapeHTML(p.unit || "kg")}</td>
                <td>${statusBadge(p.status)}</td>
                <td><div class="table-actions">
                    <button class="action-button" data-action="edit-product" data-id="${escapeHTML(id)}">Edit</button>
                    <button class="action-button danger" data-action="delete-product" data-id="${escapeHTML(id)}">Delete</button>
                </div></td>
            </tr>`;
        }).join("")}</tbody>
    </table>`;
}

function renderOrders() {
    const query = $("orderSearch").value.trim().toLowerCase();
    const status = $("orderStatusFilter").value;

    const orders = state.orders.filter(o => {
        const searchable = [
            o.orderId ?? o.order_id,
            o.buyerName ?? o.buyer_name,
            o.productName ?? o.product_name,
            o.status
        ].join(" ").toLowerCase();
        return searchable.includes(query) && (status === "all" || o.status === status);
    });

    const target = $("ordersContainer");
    if (!orders.length) {
        target.innerHTML = '<p class="empty-state">No matching customer orders.</p>';
        return;
    }

    target.innerHTML = `<table>
        <thead><tr><th>Order</th><th>Buyer</th><th>Product</th><th>Quantity</th><th>Total</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${orders.map(o => {
            const id = o.orderId ?? o.order_id;
            let actions = "—";
            if (o.status === "pending") {
                actions = `<button class="action-button" data-action="order-status" data-id="${escapeHTML(id)}" data-status="accepted">Accept</button>
                    <button class="action-button danger" data-action="order-status" data-id="${escapeHTML(id)}" data-status="rejected">Reject</button>`;
            } else if (o.status === "accepted") {
                actions = `<button class="action-button" data-action="order-status" data-id="${escapeHTML(id)}" data-status="completed">Complete</button>`;
            }

            return `<tr>
                <td>#${escapeHTML(id)}</td>
                <td>${escapeHTML(o.buyerName ?? o.buyer_name ?? "Buyer")}<small>${escapeHTML(o.buyerPhone ?? o.buyer_phone ?? "")}</small></td>
                <td>${escapeHTML(o.productName ?? o.product_name ?? "Product")}</td>
                <td>${Number(o.quantity || 0).toLocaleString()}</td>
                <td>${money(o.totalPrice ?? o.total_price)}</td>
                <td>${statusBadge(o.status)}</td>
                <td><div class="table-actions">${actions}</div></td>
            </tr>`;
        }).join("")}</tbody>
    </table>`;
}

async function loadProducts() {
    const data = await request("/farmer/products");
    state.products = Array.isArray(data.products) ? data.products : [];
}

async function loadOrders() {
    const data = await request("/farmer/orders");
    state.orders = Array.isArray(data.orders) ? data.orders : [];
}

async function loadDashboard(showMessage = false) {
    if (state.busy) return;
    state.busy = true;

    try {
        await Promise.all([
            request("/farmer/overview"),
            loadProducts(),
            loadOrders()
        ]);

        renderStats();
        renderProducts();
        renderOrders();
        renderRecentProducts();
        renderRecentOrders();

        if (showMessage) showNotice("Dashboard refreshed successfully.");
    } catch (error) {
        showNotice(error.message || "Could not load dashboard data.", true);
    } finally {
        state.busy = false;
    }
}

function resetProductForm() {
    $("productForm").reset();
    $("editProductId").value = "";
    $("productFormTitle").textContent = "Add a product";
    $("saveProductBtn").textContent = "Save product";
    $("cancelProductEdit").hidden = true;
}

function startProductEdit(id) {
    const p = state.products.find(x =>
        String(x.productId ?? x.product_id) === String(id)
    );

    if (!p) {
        showNotice("Product not found. Refresh and try again.", true);
        return;
    }

    $("editProductId").value = p.productId ?? p.product_id;
    $("productName").value = p.productName ?? p.product_name ?? "";
    $("productPrice").value = p.price ?? "";
    $("productQuantity").value = p.quantity ?? "";
    $("productUnit").value = p.unit || "kg";
    $("productDescription").value = p.description || "";
    $("productImage").value = p.imageUrl ?? p.image_url ?? "";
    $("productFormTitle").textContent = "Edit product";
    $("saveProductBtn").textContent = "Update product";
    $("cancelProductEdit").hidden = false;
    switchSection("add-product");
    window.scrollTo({ top: 0, behavior: "smooth" });
}

async function deleteProduct(id) {
    if (!confirm("Delete this product? This cannot be undone.")) return;

    try {
        const data = await request(`/farmer/products/${encodeURIComponent(id)}`, {
            method: "DELETE"
        });
        showNotice(data.message || "Product deleted.");
        await loadDashboard();
    } catch (error) {
        showNotice(error.message, true);
    }
}

async function updateOrderStatus(id, status) {
    const labels = { accepted: "accept", rejected: "reject", completed: "mark as completed" };
    if (!confirm(`Are you sure you want to ${labels[status]} order #${id}?`)) return;

    try {
        const data = await request(`/farmer/orders/${encodeURIComponent(id)}/status`, {
            method: "PATCH",
            body: JSON.stringify({ status })
        });
        showNotice(data.message || "Order status updated.");
        await loadDashboard();
    } catch (error) {
        showNotice(error.message, true);
    }
}

async function handleProductSubmit(event) {
    event.preventDefault();

    const id = $("editProductId").value;
    const payload = {
        productName: $("productName").value.trim(),
        price: Number($("productPrice").value),
        quantity: Number($("productQuantity").value),
        unit: $("productUnit").value,
        description: $("productDescription").value.trim(),
        imageUrl: $("productImage").value.trim()
    };

    if (!payload.productName || !Number.isFinite(payload.price) ||
        payload.price <= 0 || !Number.isFinite(payload.quantity) ||
        payload.quantity <= 0) {
        showNotice("Enter a product name, positive price and positive quantity.", true);
        return;
    }

    const button = $("saveProductBtn");
    button.disabled = true;

    try {
        const data = await request(
            id ? `/farmer/products/${encodeURIComponent(id)}` : "/farmer/products",
            {
                method: id ? "PUT" : "POST",
                body: JSON.stringify(payload)
            }
        );

        resetProductForm();
        await loadDashboard();
        switchSection("products");
        showNotice(data.message || "Product saved successfully.");
    } catch (error) {
        showNotice(error.message, true);
    } finally {
        button.disabled = false;
    }
}

async function loadUser() {
    const data = await request("/auth/me");
    const user = data.user || data;

    if (user.role !== "farmer") {
        if (user.role === "buyer") window.location.href = "/dashboard/buyer.html";
        else if (user.role === "admin") window.location.href = "/dashboard/admin.html";
        else window.location.href = "/login/login.html";
        return false;
    }

    state.user = user;
    setAccount(user);
    return true;
}

async function logout() {
    try {
        await request("/auth/logout", { method: "POST" });
    } catch (error) {
        console.error("Logout error:", error);
    } finally {
        window.location.href = "/login/login.html";
    }
}

function bindEvents() {
    document.querySelectorAll("[data-section]").forEach(button => {
        button.addEventListener("click", () => switchSection(button.dataset.section));
    });
    document.querySelectorAll("[data-go]").forEach(button => {
        button.addEventListener("click", () => switchSection(button.dataset.go));
    });

    $("productForm").addEventListener("submit", handleProductSubmit);
    $("cancelProductEdit").addEventListener("click", resetProductForm);
    $("productSearch").addEventListener("input", renderProducts);
    $("productStatusFilter").addEventListener("change", renderProducts);
    $("orderSearch").addEventListener("input", renderOrders);
    $("orderStatusFilter").addEventListener("change", renderOrders);

    $("refreshProducts").addEventListener("click", () => loadDashboard(true));
    $("refreshOrders").addEventListener("click", () => loadDashboard(true));
    $("refreshAll").addEventListener("click", () => loadDashboard(true));
    $("logoutBtn").addEventListener("click", logout);

    $("menuToggle").addEventListener("click", () => {
        $("sidebar").classList.toggle("open");
        $("mobileOverlay").classList.toggle("visible");
    });
    $("mobileOverlay").addEventListener("click", () => {
        $("sidebar").classList.remove("open");
        $("mobileOverlay").classList.remove("visible");
    });

    document.addEventListener("click", event => {
        const button = event.target.closest("[data-action]");
        if (!button) return;

        const { action, id, status } = button.dataset;
        if (action === "edit-product") startProductEdit(id);
        if (action === "delete-product") deleteProduct(id);
        if (action === "order-status") updateOrderStatus(id, status);
    });
}

async function init() {
    $("year").textContent = new Date().getFullYear();
    bindEvents();

    try {
        const allowed = await loadUser();
        if (allowed) await loadDashboard();
    } catch (error) {
        showNotice(error.message || "Unable to initialise dashboard.", true);
    }
}

document.addEventListener("DOMContentLoaded", init);
