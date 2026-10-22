# MAP Test Makeup Tracker

Shows which students still need a MAP makeup, grouped by class and teacher, from your roster and the NWEA / HMH "Students Without Valid Test Results" reports.

Everything runs in your browser. Files you add are read on your own device and are **never uploaded anywhere**.

## How to use it

1. **Master roster**: add the Student Roster by Class file (Excel or CSV). This is always the full list of students.
2. **NWEA exception files**: add the report PDFs (or CSV / Excel). You can add several at once, for example Reading, Spanish Reading, Algebra, Math and Spanish Math.
3. **Math Regents list (optional)**: add the list of students taking the Math Regents. If the file has several sheets, the page uses the one named "Regents Math" and shows a **Sheet to use** menu so you can switch. Tick which subjects they are exempt from.
4. Filter by class, teacher, subject or status. Export the makeup roster to **Excel** or **CSV**, **Copy** it for Sheets, or save the view as a **PDF**.

## Rules built in

- Anyone on the roster who is **not** on an NWEA report counts as complete for that subject.
- A student listed as **Not Tested** or Incomplete shows as **Incomplete**. A student with an Invalidation Reason shows as **Invalid**.
- The page reads the subject from each report's heading (Reading, Spanish Reading, Math, Algebra, Spanish Math), so one PDF can hold several subjects. The upload message shows what each file was read as.
- **Algebra** is 8th grade only. Other grades show a dash.
- If a student completed the regular test (**Math** or **Reading**), no Spanish makeup for that subject is needed (can be switched off).
- Students on the Regents list are exempt from the subjects you tick (Math and Algebra by default).

## How students are matched

1. By **Student ID**.
2. If there is no ID, by **name**. The roster cuts names off at 20 characters ("SMITH JANE MARI"), so a name that is the start of a longer one still matches, as long as exactly one student fits.

The Regents list can be a simple name list **or** a class-formation grid (one column per class, with tags such as "(ICT)" after each name). Tags and test scores are ignored.

Anything that matches nobody is listed on the page so you can check it, for example new students who are not on the roster yet.

> **Check the sheet.** Every student on the Regents sheet is exempt from Math and Algebra. If you pick a sheet that lists a whole grade (like "Math Name by Name"), the whole grade is exempt. Use the sheet with only the students taking the Regents.

## Publish on GitHub Pages

1. Sign in at github.com and click **New repository**. Name it `map-makeup-tracker`.
2. Click **uploading an existing file** (or **Add file > Upload files**) and drag in everything from this folder:
   `index.html`, `app.jsx`, `styles.css`, `README.md`, `.nojekyll`, `.gitignore`, and the `sample-data` folder.
   Files that start with a dot may be hidden on a Mac. Press **Cmd + Shift + .** in the folder to show them. `.nojekyll` and `.gitignore` are optional.
3. Click **Commit changes**.
4. Open **Settings > Pages**. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, and **Save**.
5. After about a minute your site is at `https://YOUR-USERNAME.github.io/map-makeup-tracker/`. Bookmark it.

**To update later:** upload the new file over the old one with the same name and commit. Then hard-refresh the site (Ctrl + Shift + R, or Cmd + Shift + R on a Mac).

## Try it without student data

Use the files in `sample-data/` (all names and IDs are invented), or the **Load sample data** button on the page.

## Student privacy (please read)

GitHub Pages sites are **public**, and so is the code. Because of that:

- This repo contains **no student data**. Never upload your roster, NWEA reports, the Regents list or exports to it.
- Add your files each time you open the page. They stay in your browser tab and are gone when you close or refresh it.
- `.gitignore` blocks `.xlsx`, `.csv`, `.pdf` files when using Git. Uploading through the GitHub website skips that safety, so double-check what you drag in.
- The page asks search engines not to list it (`noindex`). That is a request, not protection.

Check your district's guidance on student data before using any outside tool with real rosters.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| Page is blank | Open it from the `github.io` link, not by double-clicking `index.html`. Check you are online. |
| Old behavior after an update | Hard-refresh (Ctrl/Cmd + Shift + R). |
| "Last NWEA upload" says 0 rows | The file may be a scan. Download the report from NWEA again. |
| Students listed under "did not match" | They are not on the roster (new students) or the ID differs. Check the roster's ID column in **Check column mapping**. |
| Everyone shows Complete | No NWEA file is added yet, or none of its students matched. |

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page shell and library links |
| `app.jsx` | All of the tracker's logic and screens |
| `styles.css` | Colors, layout, light and dark mode |
| `sample-data/` | Invented sample files for testing |
| `.nojekyll` | Tells GitHub Pages to serve the files as they are |
| `.gitignore` | Keeps spreadsheets and PDFs out of Git |

Needs internet to load fonts and libraries (React, Tailwind, SheetJS, pdf.js, jsPDF) from public CDNs. To test on your own computer, run `python3 -m http.server` in this folder and open `http://localhost:8000`.
