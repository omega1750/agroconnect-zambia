
"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("loginForm");
    const emailInput = document.getElementById("email");
    const passwordInput = document.getElementById("password");
    const rememberMe = document.getElementById("rememberMe");
    const togglePassword = document.getElementById("togglePassword");
    const submitButton = document.getElementById("submitButton");
    const messageBox = document.getElementById("loginMessage");
    const googleButton = document.getElementById("googleButton");

    document.getElementById("currentYear").textContent =
        new Date().getFullYear();

    /*
     * Remember only the email/phone identifier.
     * Never save the password in localStorage.
     */
    try {
        const rememberedIdentifier = localStorage.getItem("agroconnect.rememberedIdentifier");
        if (rememberedIdentifier) {
            emailInput.value = rememberedIdentifier;
            rememberMe.checked = true;
        }
    } catch (error) {
        console.warn("Remember-me storage is unavailable.");
    }

    function showMessage(message, type = "error") {
        messageBox.textContent = message;
        messageBox.className = "form-message" +
            (type === "success" ? " success" : "");
        messageBox.hidden = false;
    }

    function clearMessage() {
        messageBox.hidden = true;
        messageBox.textContent = "";
        messageBox.className = "form-message";
    }

    function setLoading(isLoading) {
        submitButton.disabled = isLoading;
        submitButton.classList.toggle("loading", isLoading);
        submitButton.querySelector(".button-label").textContent =
            isLoading ? "Signing in..." : "Sign In";
    }

    togglePassword.addEventListener("click", () => {
        const visible = passwordInput.type === "password";

        passwordInput.type = visible ? "text" : "password";
        togglePassword.classList.toggle("is-visible", visible);
        togglePassword.setAttribute("aria-pressed", String(visible));
        togglePassword.setAttribute(
            "aria-label",
            visible ? "Hide password" : "Show password"
        );
    });

    /*
     * Google authentication requires a configured OAuth provider.
     * Do not display a fake success message.
     */
    googleButton.addEventListener("click", () => {
        showMessage(
            "Google sign-in is not configured yet. Please use your AgroConnect email/phone and password."
        );
    });

    /*
     * Adjust these paths only if your actual login or dashboard
     * filenames are different.
     */
    function getDashboardPath(role) {
        const routes = {
            farmer: "/dashboard/farmer.html",
            buyer: "/dashboard/buyer.html",
            admin: "/dashboard/admin.html"
        };

        return routes[String(role || "").toLowerCase()] || null;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearMessage();

        const identifier = emailInput.value.trim();
        const password = passwordInput.value;

        if (!identifier) {
            showMessage("Please enter your email address or phone number.");
            emailInput.focus();
            return;
        }

        if (!password) {
            showMessage("Please enter your password.");
            passwordInput.focus();
            return;
        }

        setLoading(true);

        try {
            /*
             * This expects your existing endpoint to accept
             * { email, password }. If your backend uses a different
             * identifier property, match it here.
             */
            const response = await fetch("/api/auth/login", {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    email: identifier,
                    password
                })
            });

            const result = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(
                    result.message ||
                    "Sign-in failed. Check your details and try again."
                );
            }

            /*
             * Remember the identifier only when the checkbox is selected.
             */
            try {
                if (rememberMe.checked) {
                    localStorage.setItem(
                        "agroconnect.rememberedIdentifier",
                        identifier
                    );
                } else {
                    localStorage.removeItem("agroconnect.rememberedIdentifier");
                }
            } catch (error) {
                console.warn("Could not save the remember-me preference.");
            }

            /*
             * Support common response shapes from Express APIs.
             */
            let user = result.user || result.data?.user || result.data || result;
            let role = user.role;

            /*
             * If the login response doesn't include a role, ask the
             * existing session endpoint which account signed in.
             */
            if (!role) {
                const meResponse = await fetch("/api/auth/me", {
                    credentials: "same-origin"
                });

                const meResult = await meResponse.json().catch(() => ({}));

                if (!meResponse.ok) {
                    throw new Error(
                        "You signed in, but we could not verify your account role. Please try again."
                    );
                }

                user = meResult.user || meResult;
                role = user.role;
            }

            const destination = getDashboardPath(role);

            if (!destination) {
                throw new Error(
                    "Your account role is not recognised. Please contact the administrator."
                );
            }

            window.location.replace(destination);
        } catch (error) {
            showMessage(
                error.message ||
                "Unable to connect to AgroConnect. Check your connection and try again."
            );
        } finally {
            setLoading(false);
        }
    });
});
