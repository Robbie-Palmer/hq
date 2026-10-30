# PDF resume generator

The generator builds `ui/public/robbie-palmer-resume.pdf` from the site's
canonical employment and project files. It does not contain separate resume
copy.

Run the repository tasks through mise:

```console
mise //:resume:generate
mise //:resume:check
mise //:resume:preview
```

The generated provenance file records a SHA-256 digest for every source file,
the selected project slugs, the PDF digest, its link inventory, and its page
count. The check task regenerates the artifact, compares its bytes, extracts
its text, verifies every expected hyperlink, and enforces the two-page A4
layout.

The preview task writes two SVG pages under `artifacts/resume-preview`. It uses
the same measured layout as the PDF writer and exists for quick visual review.

Project selection is mechanical. The generator sorts active, completed, and
live projects by their canonical `updated` and `date` fields, then takes the
five newest projects with a role or a repository or demo URL. Skills come from
technology frequency across the five newest employment records.
