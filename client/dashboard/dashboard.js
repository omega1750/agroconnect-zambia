
const userName = document.getElementById("userName");
const welcomeTitle = document.getElementById("welcomeTitle");
const userRole = document.getElementById("userRole");
const dashboardMessage = document.getElementById("dashboardMessage");
const logoutButton = document.getElementById("logoutButton");

async function loadDashboard() {
    try {
        const response = await fetch("/api/auth/me", {
            method: "GET",
            credentials: "same-origin"
        });

        if (response.status === 401) {
            window.location.replace("/login/login.html");
            return;
        }

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                result.message || "Unable to load your account."
            );
        }

        const user = result.user;

        if (!user || !user.fullName || !user.role) {
            window.location.replace("/login/login.html");
            return;
        }

        userName.textContent = user.fullName;
        welcomeTitle.textContent = `Welcome, ${user.fullName}!`;
        userRole.textContent = user.role;

        // Show different links according to the user's account type.
        const browseLink = document.getElementById("browseLink");
        const ordersLink = document.getElementById("ordersLink");

        if (user.role === "farmer") {
            browseLink.textContent = "Manage Produce";
            ordersLink.textContent = "View Sales";
        } else {
            browseLink.textContent = "Browse Products";
            ordersLink.textContent = "View Purchases";
        }

    } catch (error) {
        dashboardMessage.textContent =
            error.message || "Could not connect to the server.";

        console.error("Dashboard error:", error);
    }
}

logoutButton.addEventListener("click", async () => {
    logoutButton.disabled = true;
    logoutButton.textContent = "Logging out...";

    try {
        const response = await fetch("/api/auth/logout", {
            method: "POST",
            credentials: "same-origin"
        });

        if (!response.ok) {
            throw new Error("Logout failed. Please try again.");
        }

        window.location.replace("/login/login.html");

    } catch (error) {
        dashboardMessage.textContent = error.message;
        logoutButton.disabled = false;
        logoutButton.textContent = "Logout";
    }
});

loadDashboard();
