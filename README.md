# Versus Signaling Server (Render Free-Tier)

This server handles:
1. **Casual Matchmaking Queue** (Instant 1v1 random pairing)
2. **Ranked Matchmaking Queue** (Glicko-2 skill-bracket pairing within +/- 150 RP)
3. **Custom Party Codes** (4-character friend invite codes: `VR-XXXX`)
4. **WebRTC P2P Signaling Relay** (SDP Offer / Answer and ICE candidate exchange)
5. **Keep-Alive Uptime Endpoint** (`/health`) to prevent free-tier idling

---

## 🚀 How to Deploy on Render (Takes 2 Minutes)

### Option A: Via GitHub (Recommended)

1. Create a new GitHub repository (public or private), e.g., `gd-versus-server`.
2. Push the contents of the `server/` folder to your repo:
   ```bash
   cd C:\Users\MarkEw\Downloads\Versus\server
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/<YOUR_USERNAME>/gd-versus-server.git
   git push -u origin main
   ```
3. Go to [dashboard.render.com](https://dashboard.render.com/) (Sign in / Sign up).
4. Click **New +** -> **Web Service**.
5. Connect your GitHub repository.
6. Configure the service:
   - **Name**: `versus-signaling` (or any name)
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Plan**: `Free`
7. Click **Create Web Service**.
8. Once deployed, Render will give you a public URL like:
   `https://versus-signaling-xxxx.onrender.com`
9. In Geometry Dash, your mod connects via:
   `wss://versus-signaling-xxxx.onrender.com` (configured in `mod.json` settings).

---

## ⚡ Prevent Free-Tier Sleep (Uptime Ping)
Render free services spin down after 15 minutes of zero traffic.
The mod includes automatic keep-alive pings (`SIGNALING_KEEPALIVE_MS = 25000`).
Additionally, you can add your URL to any free uptime monitor (like [UptimeRobot](https://uptimerobot.com/)) monitoring `https://your-service.onrender.com/health` every 5 minutes.
