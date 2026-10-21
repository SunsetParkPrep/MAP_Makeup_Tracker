# MAP Test Makeup Tracker

Find out which students still need an NWEA MAP makeup, grouped by class and teacher.

Everything runs in your browser. Files you add are read on your own device and are never uploaded anywhere.

## How it works

1. Add the **master roster** (Student Roster by Class). It is always the full list of students.
2. Add the **NWEA exception files** (CSV, Excel, or the PDFs downloaded from NWEA). These list only students with invalid or incomplete tests.
3. Anyone on the roster who is **not** on the NWEA report counts as complete for that subject.
4. Optional: add the **Math Regents list**. Those students are exempt from the MAP subjects you tick.

Built-in rules:
- Matching uses Student ID first, then name as a fallback.
- Algebra MAP is 8th grade only (other grades show N/A).
- If a student completed regular Math, no Math (Spanish) makeup is needed.
- There is no Spanish Reading test.

Export the makeup roster as Excel or CSV, copy it for Sheets, or save the current view as a PDF.

## Publish on GitHub Pages

1. Create a new repository on github.com (for example `map-makeup-tracker`).
2. Click **Add file > Upload files** and drag in every file from this folder:
   `index.html`, `styles.css`, `app.jsx`, `README.md`, `.nojekyll`, `.gitignore`
3. Commit the files.
4. Go to **Settings > Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, choose branch `main` and folder `/ (root)`, then Save.
5. After a minute your site is live at `https://YOUR-USERNAME.github.io/map-makeup-tracker/`.

Bookmark that link and it works from any computer, tablet, or phone.

## Student privacy (please read)

GitHub Pages sites are **public**, and so is the code. Because of that:

- This repo contains **no student data**. Do not add your roster, NWEA reports, or exports to it.
- Add your files each time you open the page. They stay in your browser tab and disappear when you close or refresh it.
- The included `.gitignore` blocks `.xlsx`, `.csv`, and `.pdf` files so a roster is not committed by accident when using Git. Uploading through the GitHub website skips that safety, so double-check what you drag in.
- The page is set to `noindex` so search engines are asked not to list it. That is a request, not protection.
- "Load sample data" uses invented names and IDs only.

Check your district's guidance on student data before using any outside tool with real rosters.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The page shell and library links |
| `app.jsx` | All of the tracker's logic and screens |
| `styles.css` | Colors, layout, light and dark mode |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are |
| `.gitignore` | Keeps spreadsheets and PDFs out of Git |

## Notes

- Needs an internet connection the first time to load fonts and libraries (React, Tailwind, SheetJS, pdf.js, jsPDF) from public CDNs.
- It must be opened from a web address (like your Pages link). Double-clicking `index.html` on your computer will not work because the browser blocks loading `app.jsx` from a local file.
- To test locally, run `python3 -m http.server` in this folder and open `http://localhost:8000`.
