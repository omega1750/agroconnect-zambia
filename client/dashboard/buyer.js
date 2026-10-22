"use strict";

const $ = (selector) => document.querySelector(selector);

const API = {
    me: "/api/auth/me",
    products: "/api/buyer/products",
    orders: "/api/buyer/orders",
    logout: "/api/auth/logout"
};

let currentUser = null;
let products = [];
let orders = [];
let selectedProduct = null;

async function apiRequest(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            ...(options.body ? { "Content-Type": "application/json" } : {}),
            ...(options.headers || {})
        }
    });

    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json")
        ? await response.json()
        : await response.text();

    if (!response.ok) {
        const message = data && typeof data === "object"
            ? data.message || data.error
            : data;

        throw new Error(message || `Request failed (${response.status})`);
    }

    return data;
}

function showMessage(message, type = "error") {
    const box = $("#messageBox");
    if (!box) return;

    box.textContent = message;
    box.className = `message-box ${type}`;
    box.hidden = false;

    if (type === "success") {
        window.setTimeout(() => {
            box.hidden = true;
        }, 5000);
    }
}

function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);
}

function formatMoney(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return "K0.00";

    return new Intl.NumberFormat("en-ZM", {
        style: "currency",
        currency: "ZMW",
        minimumFractionDigits: 2
    }).format(amount);
}

function formatDate(value) {
    if (!value) return "—";

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";

    return date.toLocaleDateString("en-ZM", {
        day: "numeric",
        month: "short",
        year: "numeric"
    });
}

function getProductId(product) {
    return product.product_id ?? product.productId ?? product.id;
}

function getProductName(product) {
    return product.product_name ?? product.productName ?? product.name ?? "Product";
}

function getFarmerName(product) {
    return product.farmer_name ??
        product.farmerName ??
        product.full_name ??
        "Local farmer";
}

function getPrice(product) {
    return Number(product.price ?? 0);
}

function getQuantity(product) {
    return Number(product.quantity ?? 0);
}

function getUnit(product) {
    return product.unit || "kg";
}

function getOrderStatus(order) {
    return String(order.status || "pending").toLowerCase();
}

function getOrderId(order) {
    return order.order_id ?? order.orderId ?? order.id ?? "—";
}

function getOrderProductName(order) {
    return order.product_name ?? order.productName ?? order.name ?? "Product";
}

function getOrderFarmerName(order) {
    return order.farmer_name ?? order.farmerName ?? "Local farmer";
}

function displayUser(user) {
    currentUser = user;

    const name = user.fullName || user.full_name || user.name || "Buyer";
    const email = user.email || "";
    const initial = name.trim().charAt(0).toUpperCase() || "B";

    [
        "welcomeName",
        "sidebarName",
        "accountName",
        "accountFullName"
    ].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.textContent = name;
    });

    [
        "profileAvatar",
        "topAvatar",
        "accountAvatar"
    ].forEach((id) => {
        const element = document.getElementById(id);
        if (element) element.textContent = initial;
    });

    const accountEmail = $("#accountEmail");
    if (accountEmail) accountEmail.textContent = email;

    const heading = $("#accountNameHeading");
    if (heading) heading.textContent = name;

    document.title = `${name} | AgroConnect Zambia`;
}

function showSection(sectionName) {
    const allowed = ["overview", "marketplace", "orders", "account"];
    const section = allowed.includes(sectionName) ? sectionName : "overview";

    document.querySelectorAll(".dashboard-section").forEach((element) => {
        const active = element.id === section;
        element.hidden = !active;
        element.classList.toggle("active", active);
    });

    document.querySelectorAll("[data-section]").forEach((link) => {
        link.classList.toggle("active", link.dataset.section === section);
    });

    const labels = {
        overview: "Overview",
        marketplace: "Marketplace",
        orders: "My Orders",
        account: "My Account"
    };

    const pageName = $("#pageName");
    if (pageName) pageName.textContent = labels[section];

    if (window.location.hash !== `#${section}`) {
        history.replaceState(null, "", `#${section}`);
    }

    $("#sidebar")?.classList.remove("open");
}

function renderProductCard(product) {
    const id = getProductId(product);
    const name = getProductName(product);
    const farmer = getFarmerName(product);
    const price = getPrice(product);
    const quantity = getQuantity(product);
    const unit = getUnit(product);
    const description = product.description || "Fresh produce supplied by a local farmer.";
    const image = product.image_url || product.imageUrl || "";

    const imageHTML = image
        ? `<img class="product-image" src="${escapeHTML(image)}" alt="${escapeHTML(name)}" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="product-image-placeholder" aria-hidden="true">🌱</div>`;

    const available = quantity > 0 &&
        String(product.status || "available").toLowerCase() === "available";

    return `
        <article class="product-card">
            ${imageHTML}
            <div class="product-card-content">
                <p class="eyebrow">${escapeHTML(farmer)}</p>
                <h3>${escapeHTML(name)}</h3>
                <p>${escapeHTML(description)}</p>
                <p class="product-price">${formatMoney(price)} <span>/ ${escapeHTML(unit)}</span></p>
                <p class="product-stock">
                    ${available
                        ? `${escapeHTML(quantity)} ${escapeHTML(unit)} available`
                        : "Currently unavailable"}
                </p>
                <button type="button"
                    class="primary-button"
                    data-order-product="${escapeHTML(id)}"
                    ${available ? "" : "disabled"}>
                    ${available ? "Order now" : "Unavailable"}
                </button>
            </div>
        </article>`;
}

function renderProductList(list, container, emptyText) {
    if (!container) return;

    if (!list.length) {
        container.innerHTML = `<p class="empty-state">${escapeHTML(emptyText)}</p>`;
        return;
    }

    container.innerHTML = list.map(renderProductCard).join("");
}

function getFilteredProducts() {
    const search = ($("#productSearch")?.value || "").trim().toLowerCase();
    const sort = $("#sortProducts")?.value || "newest";

    const filtered = products.filter((product) => {
        const searchable = [
            getProductName(product),
            getFarmerName(product),
            product.description,
            product.location
        ].join(" ").toLowerCase();

        return searchable.includes(search);
    });

    if (sort === "price-low") {
        filtered.sort((a, b) => getPrice(a) - getPrice(b));
    } else if (sort === "price-high") {
        filtered.sort((a, b) => getPrice(b) - getPrice(a));
    } else if (sort === "name") {
        filtered.sort((a, b) => getProductName(a).localeCompare(getProductName(b)));
    } else {
        filtered.sort((a, b) =>
            new Date(b.created_at || b.createdAt || 0) -
            new Date(a.created_at || a.createdAt || 0)
        );
    }

    return filtered;
}

function renderMarketplace() {
    const filtered = getFilteredProducts();

    const count = $("#productResultCount");
    if (count) {
        count.textContent = `${filtered.length} product${filtered.length === 1 ? "" : "s"} found`;
    }

    renderProductList(filtered, $("#productsContainer"), "No products match your search.");

    const availableCount = $("#availableCount");
    if (availableCount) {
        availableCount.textContent = products.filter((product) =>
            getQuantity(product) > 0 &&
            String(product.status || "available").toLowerCase() === "available"
        ).length;
    }

    renderProductList(
        products.slice(0, 3),
        $("#featuredProducts"),
        "No products are available yet."
    );
}

async function loadProducts() {
    const container = $("#productsContainer");
    if (container) container.innerHTML = "<p>Loading products...</p>";

    try {
        const data = await apiRequest(API.products);
        products = Array.isArray(data) ? data : data.products || [];
        renderMarketplace();
    } catch (error) {
        console.error("Could not load marketplace products:", error);

        if (container) {
            container.innerHTML = `
                <div class="empty-state">
                    <p>Unable to load products.</p>
                    <p>${escapeHTML(error.message)}</p>
                    <button type="button" class="secondary-button" id="retryProducts">
                        Try again
                    </button>
                </div>`;
        }

        const featured = $("#featuredProducts");
        if (featured) featured.innerHTML = "<p>Products could not be loaded.</p>";

        showMessage(`Could not load products: ${error.message}`);
    }
}

function renderStats() {
    const total = $("#totalOrders");
    const pending = $("#pendingOrders");
    const completed = $("#completedOrders");

    if (total) total.textContent = orders.length;

    if (pending) {
        pending.textContent = orders.filter((order) =>
            getOrderStatus(order) === "pending"
        ).length;
    }

    if (completed) {
        completed.textContent = orders.filter((order) =>
            getOrderStatus(order) === "completed"
        ).length;
    }
}

function statusBadge(status) {
    const normalized = String(status || "pending").toLowerCase();

    return `<span class="status-badge status-${escapeHTML(normalized)}">${escapeHTML(
        normalized.charAt(0).toUpperCase() + normalized.slice(1)
    )}</span>`;
}

function renderRecentOrders() {
    const body = $("#recentOrdersBody");
    if (!body) return;

    const recent = orders.slice(0, 5);

    if (!recent.length) {
        body.innerHTML = `<tr><td colspan="5">You have not placed any orders yet.</td></tr>`;
        return;
    }

    body.innerHTML = recent.map((order) => `
        <tr>
            <td>#${escapeHTML(getOrderId(order))}</td>
            <td>${escapeHTML(getOrderProductName(order))}</td>
            <td>${escapeHTML(order.quantity ?? 0)}</td>
            <td>${formatMoney(order.total_price ?? order.totalPrice ?? 0)}</td>
            <td>${statusBadge(getOrderStatus(order))}</td>
        </tr>
    `).join("");
}

function renderOrders() {
    const body = $("#ordersTableBody");
    if (!body) return;

    const search = ($("#orderSearch")?.value || "").trim().toLowerCase();
    const status = ($("#orderStatusFilter")?.value || "all").toLowerCase();

    const filtered = orders.filter((order) => {
        const searchable = [
            getOrderId(order),
            getOrderProductName(order),
            getOrderFarmerName(order),
            order.status
        ].join(" ").toLowerCase();

        return searchable.includes(search) &&
            (status === "all" || getOrderStatus(order) === status);
    });

    if (!filtered.length) {
        body.innerHTML = "";
    } else {
        body.innerHTML = filtered.map((order) => `
            <tr>
                <td>#${escapeHTML(getOrderId(order))}</td>
                <td>${escapeHTML(getOrderProductName(order))}</td>
                <td>${escapeHTML(getOrderFarmerName(order))}</td>
                <td>${escapeHTML(order.quantity ?? 0)}</td>
                <td>${formatMoney(order.total_price ?? order.totalPrice ?? 0)}</td>
                <td>${formatDate(order.created_at ?? order.createdAt)}</td>
                <td>${statusBadge(getOrderStatus(order))}</td>
            </tr>
        `).join("");
    }

    const table = body.closest("table");
    if (table) table.hidden = filtered.length === 0;

    const empty = $("#ordersEmpty");
    if (empty) empty.hidden = filtered.length !== 0;
}

async function loadOrders() {
    const body = $("#ordersTableBody");
    if (body) {
        body.innerHTML = '<tr><td colspan="7">Loading orders...</td></tr>';
        const table = body.closest("table");
        if (table) table.hidden = false;
    }

    try {
        const data = await apiRequest(API.orders);
        orders = Array.isArray(data) ? data : data.orders || [];

        renderStats();
        renderOrders();
        renderRecentOrders();
    } catch (error) {
        console.error("Could not load buyer orders:", error);

        if (body) {
            body.innerHTML = `<tr><td colspan="7">Unable to load orders: ${escapeHTML(error.message)}</td></tr>`;
        }

        showMessage(`Could not load orders: ${error.message}`);
    }
}

function openOrderModal(productId) {
    selectedProduct = products.find((product) =>
        String(getProductId(product)) === String(productId)
    );

    if (!selectedProduct) {
        showMessage("That product could not be found. Refresh the marketplace and try again.");
        return;
    }

    if (getQuantity(selectedProduct) <= 0) {
        showMessage("This product is currently unavailable.");
        return;
    }

    $("#orderProductId").value = getProductId(selectedProduct);
    $("#modalProductName").textContent = getProductName(selectedProduct);
    $("#modalFarmerName").textContent = getFarmerName(selectedProduct);
    $("#modalProductPrice").textContent =
        `${formatMoney(getPrice(selectedProduct))} per ${getUnit(selectedProduct)}`;
    $("#modalProductDescription").textContent =
        selectedProduct.description || "Fresh produce from a local farmer.";

    $("#orderQuantity").value = "1";
    $("#orderQuantity").max = String(getQuantity(selectedProduct));
    $("#quantityHelp").textContent =
        `Available: ${getQuantity(selectedProduct)} ${getUnit(selectedProduct)}.`;

    updateOrderTotal();

    const modal = $("#orderModal");
    modal.hidden = false;
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("role", "dialog");
    $("#orderQuantity").focus();
}

function closeOrderModal() {
    const modal = $("#orderModal");
    if (modal) modal.hidden = true;

    selectedProduct = null;
}

function updateOrderTotal() {
    const quantityInput = $("#orderQuantity");
    if (!quantityInput) return;

    let quantity = Number.parseInt(quantityInput.value, 10);
    if (!Number.isFinite(quantity) || quantity < 1) quantity = 1;

    if (selectedProduct) {
        quantity = Math.min(quantity, getQuantity(selectedProduct));
        $("#estimatedTotal").textContent =
            formatMoney(quantity * getPrice(selectedProduct));
    } else {
        $("#estimatedTotal").textContent = "—";
    }
}

async function placeOrder(event) {
    event.preventDefault();

    if (!selectedProduct) {
        showMessage("Please select a product first.");
        return;
    }

    const quantity = Number.parseInt($("#orderQuantity").value, 10);
    const available = getQuantity(selectedProduct);

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > available) {
        showMessage(`Enter a quantity between 1 and ${available}.`);
        return;
    }

    const button = $("#placeOrderBtn");
    button.disabled = true;
    button.textContent = "Placing order...";

    try {
        const productId = getProductId(selectedProduct);

        await apiRequest(API.orders, {
            method: "POST",
            body: JSON.stringify({
                productId,
                product_id: productId,
                quantity
            })
        });

        closeOrderModal();
        showMessage("Your order was placed successfully.", "success");

        await Promise.all([loadProducts(), loadOrders()]);
        showSection("orders");
    } catch (error) {
        console.error("Could not place order:", error);
        showMessage(`Could not place order: ${error.message}`);
    } finally {
        button.disabled = false;
        button.textContent = "Confirm order";
    }
}

async function logout() {
    try {
        await apiRequest(API.logout, { method: "POST" });
    } catch (error) {
        console.error("Logout request failed:", error);
    }

    window.location.href = "/login/login.html";
}

function bindEvents() {
    document.querySelectorAll("[data-section]").forEach((link) => {
        link.addEventListener("click", (event) => {
            event.preventDefault();
            showSection(link.dataset.section);
        });
    });

    document.querySelectorAll("[data-go]").forEach((button) => {
        button.addEventListener("click", () => showSection(button.dataset.go));
    });

    $("#productSearch")?.addEventListener("input", renderMarketplace);
    $("#sortProducts")?.addEventListener("change", renderMarketplace);

    $("#orderSearch")?.addEventListener("input", renderOrders);
    $("#orderStatusFilter")?.addEventListener("change", renderOrders);

    $("#refreshProducts")?.addEventListener("click", loadProducts);
    $("#refreshOrders")?.addEventListener("click", loadOrders);

    $("#productsContainer")?.addEventListener("click", (event) => {
        const retry = event.target.closest("#retryProducts");
        if (retry) {
            loadProducts();
            return;
        }

        const button = event.target.closest("[data-order-product]");
        if (button && !button.disabled) {
            openOrderModal(button.dataset.orderProduct);
        }
    });

    $("#featuredProducts")?.addEventListener("click", (event) => {
        const button = event.target.closest("[data-order-product]");
        if (button && !button.disabled) {
            openOrderModal(button.dataset.orderProduct);
        }
    });

    $("#closeOrderModal")?.addEventListener("click", closeOrderModal);

    $("#orderModal")?.addEventListener("click", (event) => {
        if (event.target === $("#orderModal")) closeOrderModal();
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeOrderModal();
    });

    $("#orderQuantity")?.addEventListener("input", updateOrderTotal);

    $("#decreaseQuantity")?.addEventListener("click", () => {
        const input = $("#orderQuantity");
        input.value = Math.max(1, Number(input.value || 1) - 1);
        updateOrderTotal();
    });

    $("#increaseQuantity")?.addEventListener("click", () => {
        const input = $("#orderQuantity");
        const maximum = selectedProduct ? getQuantity(selectedProduct) : Infinity;
        input.value = Math.min(maximum, Number(input.value || 1) + 1);
        updateOrderTotal();
    });

    $("#orderForm")?.addEventListener("submit", placeOrder);

    $("#menuToggle")?.addEventListener("click", () => {
        $("#sidebar")?.classList.toggle("open");
    });

    $("#logoutBtn")?.addEventListener("click", logout);
    $("#accountLogoutBtn")?.addEventListener("click", logout);

    window.addEventListener("hashchange", () => {
        showSection(window.location.hash.slice(1) || "overview");
    });
}

async function initialize() {
    const year = $("#currentYear");
    if (year) year.textContent = new Date().getFullYear();

    bindEvents();

    try {
        const data = await apiRequest(API.me);
        const user = data.user || data;

        if (user.role && String(user.role).toLowerCase() !== "buyer") {
            window.location.href = "/login/login.html";
            return;
        }

        displayUser(user);
        showSection(window.location.hash.slice(1) || "overview");

        await Promise.all([loadProducts(), loadOrders()]);
    } catch (error) {
        console.error("Buyer dashboard initialization failed:", error);
        showMessage(`Could not initialize dashboard: ${error.message}`);

        if (error.message.toLowerCase().includes("log in") ||
            error.message.toLowerCase().includes("unauthorized") ||
            error.message.toLowerCase().includes("401")) {
            window.location.href = "/login/login.html";
        }
    }
}

document.addEventListener("DOMContentLoaded", initialize);
