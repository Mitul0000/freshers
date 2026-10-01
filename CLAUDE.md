# Incognito 5.0 — Project Context & Changelog

This document maintains architectural context, design guidelines, project structure, and the living change log for **Incognito 5.0**.

---

## 🎯 Project Overview & Theme

- **Event**: Incognito 5.0 — Freshers' Night
- **Host**: School of Cybersecurity and Digital Forensics (SCSDF)
- **Theme**: *The Godfather* / Mafia Noir Aesthetic
- **Visual Style**:
  - Dark noir background (`#0a0705`, `#16110d`) with film grain & vignette overlays
  - Metallic gold typography (Godfather display font + Goldoni serif + Italianno script)
  - Dossier / paper parchment cards with blood-red and gold accents
  - Ornate filigree golden frame border surrounding the viewport

---

## 🛠️ Tech Stack & Key Libraries

- **Framework**: Next.js 16+ (App Router, Turbopack)
- **Language**: TypeScript (`strict: true`)
- **Styling**: Tailwind CSS + Custom CSS (`src/styles/globals.css`)
- **Animations**: GSAP (hero entrance sequence) + Custom Intersection Observer (`useScrollReveal`)
- **Deployment**: Vercel (with `@vercel/analytics` and `@vercel/speed-insights`)
- **Repository**: `https://github.com/0xSRS/incognito-5.0.git` (`main` branch)

---

## 👥 The Families (Roster & Hierarchy)

1. **The Corleone Family** (Don Card)
   - *Role*: Oversees All Families
   - *Monogram*: `C`
   - *Style*: Parchment paper card, blood red accents
2. **The Tecnici Family** (Crew Card)
   - *Role*: Technical Team
   - *Monogram*: `Tc`
3. **The Tattaglia Family** (Crew Card)
   - *Role*: Creative and Marketing Team
   - *Monogram*: `Ta`
4. **The Barzini Family** (Crew Card)
   - *Role*: Decor and Stage Management Team
   - *Monogram*: `Ba`
5. **The Stracci Family** (Crew Card)
   - *Role*: Treasure Hunt Team
   - *Monogram*: `St`
6. **The Cuneo Family** (Crew Card)
   - *Role*: Logistics and Finance Team
   - *Monogram*: `Cu`
7. **Tessio's Crew** (Crew Card)
   - *Role*: Volunteer Team
   - *Monogram*: `TE`

---

## 📂 Project Structure

```
incognito-5.0/
├── public/
│   ├── fonts/                  # Godfather, Goldoni, Italianno font files
│   ├── images/                 # Event photos (frame-1 to frame-5)
│   └── favicon.png / favicon.ico
├── src/
│   ├── app/
│   │   ├── layout.tsx          # Root layout, metadata, analytics, global styles
│   │   ├── page.tsx            # Main page composition
│   │   └── globals.css
│   ├── components/
│   │   ├── CinematicArchive.tsx    # Archive photo gallery
│   │   ├── FinalCTA.tsx            # Final call-to-action button
│   │   ├── Footer.tsx              # Event footer, contact links & Instagram icon
│   │   ├── Hero.tsx                # Hero section with GSAP timeline animation
│   │   ├── InvitationSection.tsx   # File No. I — The Invitation
│   │   ├── MrMsFreshers.tsx        # File No. III — Mr. & Ms. Freshers contest cards
│   │   ├── Navigation.tsx          # Sticky navigation bar with quick links
│   │   ├── OrnateFrame.tsx         # Decorative viewport border & corner filigrees
│   │   ├── RegistrationDossiers.tsx# Registration links (Freshers & Seniors forms)
│   │   ├── StatementBreak.tsx      # Cinematic quote break
│   │   ├── TheFamilies.tsx         # File No. III — Corleone & 6 crew cards
│   │   └── TheNight.tsx            # File No. II — Date, time, venue, dress code
│   ├── lib/
│   │   └── useScrollReveal.ts      # Intersection observer reveal hook
│   └── styles/
│       └── globals.css             # Theme variables, typography, keyframes, responsive rules
├── package.json
├── tsconfig.json
├── CLAUDE.md                       # This context & changelog file
└── README.md
```

---

## 📜 Commands

- **Development**: `npm run dev` (Runs Turbopack on `http://localhost:3000`)
- **Build**: `npm run build`
- **Lint**: `npm run lint`
- **Deploy/Push**: `git push origin main`

---

## 📝 Living Changelog & Context History

### [2026-09-30] — Flag Verification, Admin QR Scanner & Backend Sanctum
- **Flag Verification Portal (`/validate-flag`, `/verify-flag`)**:
  - Implemented classified cipher dossier page styled with the Godfather mafia aesthetic.
  - Interactive cipher verification connecting to PostgreSQL backend.
  - Dynamic visual ticket issuance with attendee name, email, citation ID, high-resolution ticket preview, and direct image download.
  - SMTP email dispatch with ticket attachment containing personal clearance pass.
- **Admin Gatekeeper & Optical QR Scanner (`/sanctum-gate-9x7q`)**:
  - Moved off public `/admin` to non-guessable secure path to prevent brute-force attacks.
  - Authentication compares input against constant SHA-256 hash (`ADMIN_PASSWORD_HASH`) with zero plaintext passwords in code. Strong password: `Godfather#90$Omerta!Vault2026`.
  - Removed manual JWT paste inputs; now exclusively a streamlined optical camera viewfinder with HUD reticle, laser sweep, and audio feedback.
  - Dual QR scanning engine: WebSocket frame streaming (`/ws/scan`) + client-side `BarcodeDetector`.
  - Dynamic scan animations: Emerald & gold wax seal stamp for approved entry, blood-red denial for duplicate or invalid tickets.
  - Live guest telemetry stats and recent scans dossier history log.
  - Frame ingestion debounced during modal viewing to eliminate duplicate scan alerts.
- **Backend Architecture & PostgreSQL Docker (`backend/`)**:
  - Standalone FastAPI backend with PostgreSQL Docker container (`freshers_db`) matching schema from `sql.txt`.
  - Secure HS256 JWT ticket generation and verification.
  - PIL-powered Godfather VIP ticket generator and Titan Mail SMTP email dispatch (`smtp.titan.email:465`) with attached printable ticket PDF.
  - Next.js API proxy routes for seamless production deployment on Vercel.

### [2026-09-24] — Mobile Frame Removal & Dark Overscroll
- **Mobile Viewport Optimization**:
  - Hid `.ornate-frame` on mobile devices (`<= 768px`) via CSS `display: none !important` and updated `OrnateFrame.tsx` to omit scroll/resize handlers on mobile screens.
  - Added `background-color: #070504`, `color-scheme: dark`, and `<meta name="color-scheme" content="dark" />` so root canvas overscroll/rubber-banding is always noir dark.

### [2026-09-24] — Cuneo Family & Footer Instagram Integration
- **Added The Cuneo Family**:
  - Integrated *The Cuneo Family* (Logistics and Finance Team, Monogram `Cu`) into `TheFamilies.tsx`.
  - Updated the families section header copy.
  - Refactored `.crew-grid` in `src/styles/globals.css` to cleanly lay out 6 crew cards (3x2 on desktop, 2x3 on tablet, 1x6 on mobile) without orphan nth-child offsets.
- **Footer Instagram Logo**:
  - Added custom SVG Instagram icon styled with gold gradient / `var(--gold-bright)` in `Footer.tsx`.
  - Linked icon directly to `https://www.instagram.com/incognito_scsdf_5.0/` with hover animations.
- **Event Metadata Alignment**:
  - Synced event time to `4:00 PM Onwards` across `Hero.tsx` and `TheNight.tsx`.
  - Synchronized file dossier indexing across sections.

---

## ⚠️ Instructions for Future Updates

Whenever making changes to this codebase:
1. **Maintain Aesthetic Consistency**: Always preserve the Godfather noir palette (`--black`, `--parchment`, `--gold`, `--gold-bright`, `--blood`).
2. **Responsive Checks**: Verify layouts across mobile (<480px, <640px), tablet (<768px, <960px), and desktop.
3. **Log Changes**: Update the **Living Changelog** section in this file (`CLAUDE.md`) whenever a feature, layout, or copy change is implemented.
