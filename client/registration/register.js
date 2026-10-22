
"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("registerForm");
    const message = document.getElementById("formMessage");
    const submitBtn = document.getElementById("submitBtn");
    const buttonText = document.getElementById("buttonText");

    const fields = {
        fullName: document.getElementById("fullName"),
        email: document.getElementById("email"),
        phone: document.getElementById("phone"),
        location: document.getElementById("location"),
        password: document.getElementById("password"),
        confirmPassword: document.getElementById("confirmPassword")
    };

    const errors = {
        fullName: document.getElementById("fullNameError"),
        email: document.getElementById("emailError"),
        phone: document.getElementById("phoneError"),
        location: document.getElementById("locationError"),
        password: document.getElementById("passwordError"),
        confirmPassword: document.getElementById("confirmPasswordError"),
        terms: document.getElementById("termsError")
    };

    const strengthBar = document.getElementById("strengthBar");
    const strengthText = document.getElementById("strengthText");
    const terms = document.getElementById("terms");

    // Update selected account type.
    document.querySelectorAll('input[name="role"]').forEach(radio => {
        radio.addEventListener("change", () => {
            document.querySelectorAll(".type-card").forEach(card => {
                const cardRadio = card.querySelector('input[name="role"]');
                card.classList.toggle("selected", cardRadio.checked);
            });
        });
    });

    // Show and hide password fields.
    document.querySelectorAll(".toggle-password").forEach(button => {
        button.addEventListener("click", () => {
            const input = document.getElementById(button.dataset.target);

            if (!input) return;

            const showPassword = input.type === "password";

            input.type = showPassword ? "text" : "password";
            button.textContent = showPassword ? "Hide" : "Show";

            button.setAttribute(
                "aria-label",
                showPassword ? "Hide password" : "Show password"
            );
        });
    });

    function setError(name, text) {
        if (errors[name]) {
            errors[name].textContent = text;
        }

        if (fields[name]) {
            fields[name].setAttribute(
                "aria-invalid",
                text ? "true" : "false"
            );
        }
    }

    function clearErrors() {
        Object.keys(errors).forEach(name => {
            errors[name].textContent = "";
        });

        Object.values(fields).forEach(input => {
            input.removeAttribute("aria-invalid");
        });
    }

    function showMessage(text, type) {
        message.textContent = text;
        message.className = `message ${type}`;
        message.hidden = false;
    }

    // Password strength indicator.
    function passwordStrength(password) {
        if (!password) {
            return {
                score: 0,
                label: "Use at least 8 characters."
            };
        }

        let score = 0;

        if (password.length >= 8) score++;
        if (password.length >= 12) score++;
        if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
        if (/\d/.test(password)) score++;
        if (/[^A-Za-z0-9]/.test(password)) score++;

        if (password.length < 8) {
            return {
                score: 1,
                label: "Too short — use at least 8 characters."
            };
        }

        if (score <= 2) {
            return { score: 2, label: "Weak password" };
        }

        if (score <= 3) {
            return { score: 3, label: "Moderate password" };
        }

        return { score: 4, label: "Strong password" };
    }

    fields.password.addEventListener("input", () => {
        const result = passwordStrength(fields.password.value);

        const widths = ["0%", "25%", "45%", "70%", "100%"];
        const colors = [
            "#dc2626",
            "#dc2626",
            "#ea580c",
            "#ca8a04",
            "#15803d"
        ];

        strengthBar.style.width = widths[result.score];
        strengthBar.style.background = colors[result.score];
        strengthText.textContent = result.label;

        if (fields.password.value) {
            setError(
                "password",
                fields.password.value.length < 8
                    ? "Password must contain at least 8 characters."
                    : new TextEncoder().encode(fields.password.value).length > 72
                        ? "Password must not exceed 72 UTF-8 bytes."
                        : ""
            );
        }

        if (fields.confirmPassword.value) {
            setError(
                "confirmPassword",
                fields.password.value === fields.confirmPassword.value
                    ? ""
                    : "Passwords do not match."
            );
        }
    });

    fields.confirmPassword.addEventListener("input", () => {
        setError(
            "confirmPassword",
            fields.password.value === fields.confirmPassword.value
                ? ""
                : "Passwords do not match."
        );
    });

    // Clear errors as the user edits fields.
    Object.entries(fields).forEach(([name, input]) => {
        input.addEventListener("input", () => {
            if (errors[name].textContent) {
                setError(name, "");
            }
        });

        input.addEventListener("change", () => {
            if (errors[name].textContent) {
                setError(name, "");
            }
        });
    });

    terms.addEventListener("change", () => {
        errors.terms.textContent = terms.checked
            ? ""
            : "Please accept the terms to continue.";
    });

    // Validate every required field.
    function validateForm() {
        clearErrors();

        let valid = true;

        const fullName = fields.fullName.value.trim();
        const email = fields.email.value.trim();
        const phone = fields.phone.value.trim();
        const location = fields.location.value.trim();
        const password = fields.password.value;
        const confirmPassword = fields.confirmPassword.value;

        if (fullName.length < 2 || fullName.length > 100) {
            setError(
                "fullName",
                "Enter a name between 2 and 100 characters."
            );
            valid = false;
        } else if (/[<>]/.test(fullName)) {
            setError("fullName", "Please enter a valid name.");
            valid = false;
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailPattern.test(email) || email.length > 190) {
            setError("email", "Enter a valid email address.");
            valid = false;
        }

        const phoneDigits = phone.replace(/\D/g, "");

        if (
            !/^[+\d\s()-]+$/.test(phone) ||
            phoneDigits.length < 9 ||
            phoneDigits.length > 15
        ) {
            setError("phone", "Enter a valid phone number.");
            valid = false;
        }

        if (!location) {
            setError("location", "Please select your province.");
            valid = false;
        }

        const passwordBytes = new TextEncoder().encode(password).length;

        if (password.length < 8) {
            setError(
                "password",
                "Password must contain at least 8 characters."
            );
            valid = false;
        } else if (passwordBytes > 72) {
            setError(
                "password",
                "Password must not exceed 72 UTF-8 bytes."
            );
            valid = false;
        }

        if (password !== confirmPassword) {
            setError("confirmPassword", "Passwords do not match.");
            valid = false;
        }

        if (!terms.checked) {
            errors.terms.textContent =
                "Please accept the terms to continue.";
            valid = false;
        }

        const selectedRole = form.querySelector(
            'input[name="role"]:checked'
        );

        if (
            !selectedRole ||
            !["farmer", "buyer"].includes(selectedRole.value)
        ) {
            showMessage(
                "Please select Farmer or Buyer as your account type.",
                "error"
            );
            valid = false;
        }

        return valid;
    }

    // Submit registration to the existing Express API.
    form.addEventListener("submit", async event => {
        event.preventDefault();
        message.hidden = true;

        if (!validateForm()) {
            const firstInvalid = form.querySelector(
                '[aria-invalid="true"]'
            );

            if (firstInvalid) {
                firstInvalid.focus();
            } else if (!terms.checked) {
                terms.focus();
            }

            return;
        }

        const role = form.querySelector(
            'input[name="role"]:checked'
        ).value;

        // IMPORTANT: confirmPassword is required by auth.routes.js.
        const payload = {
            fullName: fields.fullName.value.trim(),
            email: fields.email.value.trim(),
            phone: fields.phone.value.trim(),
            location: fields.location.value.trim(),
            password: fields.password.value,
            confirmPassword: fields.confirmPassword.value,
            role
        };

        submitBtn.disabled = true;
        buttonText.textContent = "Creating your account...";

        try {
            const response = await fetch("/api/auth/register", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: "same-origin",
                body: JSON.stringify(payload)
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                showMessage(
                    data.message ||
                    data.error ||
                    "Registration failed. Please check your details.",
                    "error"
                );
                return;
            }

            showMessage(
                data.message ||
                "Registration successful! Redirecting to login...",
                "success"
            );

            form.reset();

            // Restore Farmer as the default selection.
            document.querySelectorAll(".type-card").forEach(card => {
                const radio = card.querySelector(
                    'input[name="role"]'
                );

                card.classList.toggle(
                    "selected",
                    radio.value === "farmer"
                );
            });

            strengthBar.style.width = "0%";
            strengthText.textContent = "Use at least 8 characters.";

            // Redirect only after the API confirms success.
            window.location.assign("/login/login.html");
        } catch (error) {
            console.error("Registration request failed:", error);

            showMessage(
                "Could not connect to AgroConnect. Check that the server is running and try again.",
                "error"
            );
        } finally {
            submitBtn.disabled = false;
            buttonText.textContent = "Create my account";
        }
    });
});
