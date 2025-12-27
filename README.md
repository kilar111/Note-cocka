# NOTE කොක්ක (Study Materials Site)

Simple educational website for students to search and access study materials.

## Tech
- Frontend: HTML/CSS/JavaScript (no framework)
- Backend: Node.js + Express
- Storage: JSON file (`data/posts.json`)

## Setup
1. Install dependencies:
   - `npm install`
2. Create environment file:
   - copy `.env.example` → `.env`
3. Create local database file:
   - copy `data/posts.example.json` → `data/posts.json`
4. Run:
   - `npm start`
5. Open:
   - `http://localhost:3000`

## Notes
- Admin page: `/admin`
- Uploads are stored in `public/uploads/` (not committed to git).
- Local data is stored in `data/posts.json` (not committed to git).
