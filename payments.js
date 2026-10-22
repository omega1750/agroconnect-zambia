"use strict";

const orderSelect = document.getElementById("orderId");
const paymentForm = document.getElementById("paymentForm");
const paymentMethod = document.getElementById("paymentMethod");
const phoneInput = document.getElementById("phone");
const orderBalance = document.getElementById("orderBalance");
const formMessage = document.getElementById("formMessage");
const payButton = document.getElementById("payButton");
const paymentsList = document.getElementById("paymentsList");
const refreshButton = document.getElementById("refreshButton");
const logoutButton = document.getElementById("logoutButton");

let orders = [];
let payments = [];

async function api(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        ...options,
        headers: {
            "Content-Type": "application/json",
            ...(options.headers || {})
        }
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 401) {
        window.location.href = "/login/login.html";
        throw new Error("Your session has expired. Please log in again.");
    }

    if (!response.ok) {
        throw new Error(data.message || "The request failed.");
    }

    return data;
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[character]);
}

function money(value) {
    return "K" + Number(value || 0).toLocaleString("en-ZM", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function dateText(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleString();
}

function showMessage(message, type = "") {
    formMessage.textContent = message;
    formMessage.className = type;
}

function renderOrders() {
    if (!orders.length) {
        orderSelect.innerHTML = '<option value="">No eligible orders found</option>';
        orderBalance.textContent = "Only accepted or completed orders can be paid.";
        return;
    }

    orderSelect.innerHTML = [
        '<option value="">Choose an order</option>',
        ...orders.map(order => {
            const title = `Order #${order.orderId} — ${order.productName || "Product"} — Balance ${money(order.balance)}`;
            return `<option value="${Number(order.orderId)}">${escapeHtml(title)}</option>`;
        })
    ].join("");

    updateBalance();
}

function updateBalance() {
    const order = orders.find(item => Number(item.orderId) === Number(orderSelect.value));

    orderBalance.textContent = order
        ? `Order total: ${money(order.totalPrice)} | Paid: ${money(order.amountPaid)} | Balance: ${money(order.balance)}`
        : "Choose an order to view its balance.";

    payButton.disabled = !order || Number(order.balance) <= 0;
}

function renderPayments() {
    if (!payments.length) {
        paymentsList.innerHTML = '<p class="muted">No payment requests found yet.</p>';
        return;
    }

    paymentsList.innerHTML = `
        <div class="table-wrap">
            <table>
                <thead>
                    <tr>
                        <th>Reference</th>
                        <th>Order</th>
                        <th>Amount</th>
                        <th>Method</th>
                        <th>Status</th>
                        <th>Date</th>
                        <th>Test controls</th>
                    </tr>
                </thead>
                <tbody>
                    ${payments.map(payment => {
                        const status = String(payment.status || "pending").toLowerCase();
                        const method = payment.paymentMethod === "mtn_momo"
                            ? "MTN MoMo"
                            : payment.paymentMethod === "airtel_money"
                                ? "Airtel Money"
                                : payment.paymentMethod;

                        return `
                            <tr>
                                <td>${escapeHtml(payment.transactionReference)}</td>
                                <td>#${Number(payment.orderId)}</td>
                                <td>${money(payment.amount)}</td>
                                <td>${escapeHtml(method)}</td>
                                <td><span class="status ${escapeHtml(status)}">${escapeHtml(status)}</span></td>
                                <td>${dateText(payment.createdAt)}</td>
                                <td>
                                    ${status === "pending" ? `
                                        <div class="payment-actions">
                                            <button type="button"
                                                data-payment-id="${Number(payment.paymentId)}"
                                                data-outcome="successful">
                                                Simulate success
                                            </button>
                                            <button type="button" class="fail"
                                                data-payment-id="${Number(payment.paymentId)}"
                                                data-outcome="failed">
                                                Simulate failure
                                            </button>
                                        </div>
                                    ` : '<span class="muted">No action</span>'}
                                </td>
                            </tr>
                        `;
                    }).join("")}
                </tbody>
            </table>
        </div>
        <p class="muted">Test controls simulate a result only. They do not contact a mobile-money provider.</p>
    `;
}

async function loadOrders() {
    const data = await api("/api/payments/orders");
    orders = Array.isArray(data.orders) ? data.orders : [];
    renderOrders();
}

async function loadPayments() {
    const data = await api("/api/payments/mine");
    payments = Array.isArray(data.payments) ? data.payments : [];
    renderPayments();
}

async function refreshAll() {
    refreshButton.disabled = true;

    try {
        await Promise.all([loadOrders(), loadPayments()]);
    } catch (error) {
        showMessage(error.message, "error");
        paymentsList.textContent = error.message;
    } finally {
        refreshButton.disabled = false;
    }
}

orderSelect.addEventListener("change", updateBalance);

paymentMethod.addEventListener("change", () => {
    phoneInput.placeholder = paymentMethod.value === "mtn_momo"
        ? "Enter your MTN mobile-money number"
        : "Enter your Airtel mobile-money number";
});

paymentForm.addEventListener("submit", async event => {
    event.preventDefault();
    showMessage("");

    const orderId = Number(orderSelect.value);
    const order = orders.find(item => Number(item.orderId) === orderId);

    if (!order) {
        showMessage("Please select an order.", "error");
        return;
    }

    if (Number(order.balance) <= 0) {
        showMessage("This order has no outstanding balance.", "error");
        return;
    }

    payButton.disabled = true;

    try {
        const result = await api("/api/payments", {
            method: "POST",
            body: JSON.stringify({
                orderId,
                paymentMethod: paymentMethod.value,
                phone: phoneInput.value.trim()
            })
        });

        showMessage(
            `${result.message} Reference: ${result.payment.transactionReference}`,
            "success"
        );

        await refreshAll();
    } catch (error) {
        showMessage(error.message, "error");
    } finally {
        updateBalance();
    }
});

paymentsList.addEventListener("click", async event => {
    const button = event.target.closest("button[data-payment-id]");
    if (!button) return;

    const paymentId = Number(button.dataset.paymentId);
    const outcome = button.dataset.outcome;

    const confirmed = window.confirm(
        `TEST ONLY: Simulate ${outcome} for payment #${paymentId}? No real money will be transferred.`
    );

    if (!confirmed) return;

    button.disabled = true;

    try {
        const result = await api(`/api/payments/${paymentId}/simulate`, {
            method: "POST",
            body: JSON.stringify({ outcome })
        });

        showMessage(result.message, outcome === "successful" ? "success" : "error");
        await refreshAll();
    } catch (error) {
        showMessage(error.message, "error");
    } finally {
        button.disabled = false;
    }
});

refreshButton.addEventListener("click", refreshAll);

logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;

    try {
        await api("/api/auth/logout", { method: "POST" });
        window.location.href = "/login/login.html";
    } catch (error) {
        showMessage(error.message, "error");
        logoutButton.disabled = false;
    }
});

refreshAll();