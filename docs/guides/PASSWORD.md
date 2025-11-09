# 🔑 Password Setup & Management

**Quick reference for setting up and managing your CFlairCounter admin password**

---

## 🚀 Initial Setup

### Default Password

- **Default:** `admin123`
- **Environment:** Development only
- **⚠️ WARNING:** Change immediately in production!

---

## 🔐 Setting Your Password

### Method 1: Cloudflare Dashboard (Recommended)

1. **Navigate to Environment Variables:**
   ```
   Cloudflare Dashboard → Pages → cflaircounter → Settings → Environment variables
   ```

2. **Add/Edit ADMIN_PASSWORD:**
   - Click **Add variable** (or edit existing)
   - **Name:** `ADMIN_PASSWORD`
   - **Value:** Your secure password
   - **Environment:** Select **Production**
   - Click **Save**

3. **Redeploy:**
   ```
   Pages → cflaircounter → Deployments → Retry deployment
   ```
   (Required for changes to take effect)

### Method 2: Wrangler CLI

```powershell
# Set admin password via CLI
npx wrangler pages secret put ADMIN_PASSWORD

# When prompted, enter your password
# Password is hidden while typing

# Redeploy to apply
npm run deploy
```

---

## 🎯 Password Best Practices

### Recommended Password Format

**Format:** `[Service][Year][Special][Random]`

**Examples:**
```
CFlair2025!Xk9mP2qL
Counter2025#Bm8nR4tY
API2025$Wp3jK9vN
```

### Password Requirements

- **Length:** Minimum 16 characters (recommended)
- **Complexity:**
  - ✅ Uppercase letters (A-Z)
  - ✅ Lowercase letters (a-z)
  - ✅ Numbers (0-9)
  - ✅ Special characters (!@#$%^&*)
- **Uniqueness:** Don't reuse passwords from other services
- **Rotation:** Change every 90 days

### Password Strength Checker

```javascript
// Strong password example
"CFlair2025!Xk9mP2qL"
// Entropy: ~96 bits (very strong)
```

---

## ✅ Testing Your Password

### Test via Admin Panel

1. Open admin panel:
   ```
   https://counter.vkrishna04.me
   ```

2. Click **"🔒 Admin"** button

3. Enter your password

4. **Success:** Dashboard loads with statistics
   **Failure:** "Unauthorized - Invalid admin password"

### Test via API

```powershell
# Test authentication
curl -X POST https://counter.vkrishna04.me/api/admin/stats `
  -H "Content-Type: application/json" `
  -d '{\"password\": \"YourPassword\"}'

# Success response (200 OK):
# {
#   "success": true,
#   "statistics": {...},
#   "projects": [...]
# }

# Failure response (401 Unauthorized):
# {
#   "success": false,
#   "error": "Unauthorized - Invalid admin password"
# }
```

---

## 🔄 Changing Your Password

### Steps to Change Password

1. **Update in Cloudflare Dashboard:**
   ```
   Pages → Settings → Environment variables → Edit ADMIN_PASSWORD
   ```

2. **Or use Wrangler CLI:**
   ```powershell
   npx wrangler pages secret put ADMIN_PASSWORD
   # Enter new password when prompted
   ```

3. **Redeploy Application:**
   ```powershell
   npm run deploy
   ```

   Or via Dashboard:
   ```
   Pages → Deployments → Retry deployment
   ```

4. **Verify New Password:**
   - Open admin panel
   - Test with new password

---

## 🆘 Forgot Password?

### Recovery Steps

Since passwords are stored in environment variables (not hashed in database), recovery is simple:

1. **Access Cloudflare Dashboard**

2. **View Current Password:**
   ```
   Pages → cflaircounter → Settings → Environment variables
   ```

3. **See the password value** (it's stored in plain text in env vars)

4. **Or reset to new password:**
   - Edit `ADMIN_PASSWORD` variable
   - Enter new password
   - Save and redeploy

### Alternative: Check via Wrangler

```powershell
# List all environment variables (doesn't show values)
npx wrangler pages deployment list cflaircounter

# To reset without knowing old password:
npx wrangler pages secret put ADMIN_PASSWORD
# Enter new password
```

---

## 🔒 Security Considerations

### Where Passwords Are Stored

- **Cloudflare Environment Variables:** Encrypted at rest
- **Not in Git:** Never committed to repository
- **Not in Code:** Not hardcoded in source files
- **Separate Environments:** Dev and Prod have different passwords

### What's Secure

✅ Passwords stored in Cloudflare's secure infrastructure
✅ HTTPS encryption for all admin requests
✅ Server-side validation only (no client-side checks)
✅ No password stored in browser/cookies

### What's NOT Encrypted

⚠️ Passwords in environment variables are stored in **plain text**
⚠️ Anyone with Cloudflare account access can see passwords
⚠️ No brute-force protection (single-user admin system)

**Note:** This is acceptable for a single-user admin system. For multi-user systems, implement proper password hashing.

---

## 🌍 Environment-Specific Passwords

### Development Environment

```toml
# wrangler.toml
[env.development.vars]
ADMIN_PASSWORD = "admin123"  # Simple password for dev
```

**Usage:**
```powershell
# Run locally with dev password
npm run dev
# Admin password: admin123
```

### Production Environment

Set via Cloudflare Dashboard or CLI:

```powershell
# Production password (strong, unique)
ADMIN_PASSWORD = "CFlair2025!Xk9mP2qL"
```

**Result:** Dev and production use different passwords

---

## 📊 Password Audit Log

Keep track of password changes:

| Date       | Action             | New Password Format   | Changed By   |
| ---------- | ------------------ | --------------------- | ------------ |
| 2025-11-09 | Initial Setup      | `CFlair2025!Xk9mP2qL` | Setup script |
| 2026-02-09 | Rotation (90 days) | `CFlair2026!Ym4pT7wR` | Admin        |
| 2026-05-09 | Rotation (90 days) | `CFlair2026@Zn5qV8xS` | Admin        |

---

## 🛠️ Troubleshooting

### Issue: "Admin disabled" error

**Cause:** `ENABLE_ADMIN` environment variable set to `false`

**Solution:**
```powershell
# Check environment variables
# Set ENABLE_ADMIN=true in Cloudflare Dashboard
# Redeploy
```

### Issue: "Unauthorized" error with correct password

**Possible causes:**
1. Password not redeployed after change
2. Different password in dev vs. prod
3. Trailing spaces in password

**Solution:**
```powershell
# Redeploy application
npm run deploy

# Or retry deployment in Dashboard
```

### Issue: Can't access Cloudflare Dashboard

**Solution:**
- Reset Cloudflare account password
- Contact Cloudflare support
- Use recovery email

---

## 🔗 Quick Commands

### View Current Deployment

```powershell
npx wrangler pages deployment list cflaircounter
```

### Update Password

```powershell
npx wrangler pages secret put ADMIN_PASSWORD
```

### Redeploy

```powershell
npm run deploy
```

### Test Password

```powershell
curl -X POST https://counter.vkrishna04.me/api/admin/stats `
  -H "Content-Type: application/json" `
  -d '{\"password\": \"YourPassword\"}'
```

---

## ✅ Password Setup Checklist

- [ ] Changed default password from `admin123`
- [ ] Used strong password (16+ characters)
- [ ] Set in Cloudflare Dashboard (Production environment)
- [ ] Redeployed application
- [ ] Tested admin panel access
- [ ] Tested API authentication
- [ ] Documented password securely (password manager)
- [ ] Set reminder for 90-day rotation

---

## 📞 Need Help?

- **Issues:** [GitHub Issues](https://github.com/Life-Experimentalist/CFlair-Counter/issues)
- **Setup Guide:** [SETUP.md](./SETUP.md)
- **Documentation:** [docs/README.md](./docs/README.md)

---

**🔐 Remember:** Your admin password is the only authentication for the admin panel. Keep it secure!
