# 🏙️ CivicEye — Citizen Community & Field Action Platform

> **CivicEye** is an independent civic platform connecting **frustrated citizens** with **local field maintenance teams and responders**. Citizens document and map community issues; field teams (department workers, local contractors, or maintenance responders) use the **Operations Console** to resolve reports and upload visual proof.

---

## 💡 How the Repair Workflow Works (Without Red Tape)

```
[ Citizen Reports Issue ] 
       │
       ▼
[ AI Analyzes & Maps GPS ] 
       │
       ▼
[ Community Upvotes & Confirms ] 
       │
       ▼
[ Field Operations / Maintenance Team Picks Up Issue ] 
       │
       ▼
[ Crew Fixes Issue & Uploads "After" Photo ] 
       │
       ▼
[ AI Verifies Fix & Marks RESOLVED ]
```

---

## 📌 1. The 30-Second Elevator Pitch

> *"CivicEye is a community-driven civic issue platform. Citizens snap photos of local problems—like potholes, garbage dumps, or broken streetlights—and pin the exact location. AI auto-categorizes the report and notifies local field maintenance teams. Responders update progress and upload 'after' photos, which AI verifies to prove the fix. It brings 100% transparency to local repairs."*

---

## 🤝 2. Neutral Terminology (Smart & Compliant)

To keep the platform generic, modular, and legal-safe across any city or region, CivicEye uses neutral operational terms:

| Standard Role | CivicEye Neutral Term | Who Uses It |
|---|---|---|
| Citizen / Resident | **Citizen / Reporter** | Anyone reporting & tracking local issues |
| Ward Officer / Local Worker | **Field Responder / Operations Officer** | Maintenance crews & local department workers |
| Municipal Corporation / Panchayat | **Local Operations / Civic Operations** | The overall administrative team |
| Government Department | **Service Department** *(Roads, Waste, Lighting, Water)* | Category routing teams |

---

## 🧠 3. AI Capabilities Supporting the Workflow

1. **📸 AI Vision Photo Analysis (`/api/ai/analyze-image`)**
   - Auto-detects category (Potholes, Garbage, Streetlight, Water Leak) & severity from citizen photos.

2. **👯 Duplicate Prevention (`/api/ai/check-duplicate`)**
   - Groups nearby photos within 50m to avoid clogging field team queues.

3. **🤖 Field Triage Assistant (`/api/ai/triage`)**
   - Suggests department assignment, priority score, and draft updates for field responders.

4. **✅ AI Repair Verification (`/api/ai/verify-repair`)**
   - Compares Before vs After photos uploaded by field teams to verify genuine repair completion.

5. **🔍 Natural Language Search (`/api/ai/parse-query`)**
   - Type queries like *"critical potholes in Baner open this week"*.

6. **💬 CivicEye AI Assistant (`/api/ai/chat`)**
   - Answers citizen & responder questions floating across every page.

---

## 🛠️ 4. System Architecture

- **Frontend:** React 18, React Router v6, Tailwind CSS, Leaflet GIS Map.
- **Backend:** Node.js, Express.js REST API with Zod schema validation.
- **Database:** PostgreSQL (Supabase / local PG) with full audit timeline & status state machine.
- **AI Engine:** Multi-provider fallback (`Gemini API` ➔ `OpenAI` ➔ `Offline Heuristics`).

---

## 🎬 5. Quick Presentation Demo Script

1. **Live Community Map (`/map`):** Show issue clusters pinned across the city.
2. **Citizen Reporting (`/report`):** Upload a photo ➔ AI auto-detects problem type & severity.
3. **Operations Console (`/officer/dashboard`):** Show the Field Operations queue, click **"✨ Suggest AI Triage"**, and upload an **After photo**.
4. **City Analytics (`/dashboard`):** Show live resolution metrics, top reported areas, and the AI Chat Assistant.

---

## 💎 6. Why This Project is 10/10

- ** Solves Real Human Frustration:** Bridges citizen reporting with real field action.
- ** Production-Grade Architecture:** Multi-role RBAC, GIS mapping, AI vision, and repair verification.
- ** Safe & Modular Design:** Uses neutral terms so it can be deployed anywhere without direct municipal entity naming.
