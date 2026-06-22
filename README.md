# Online CE Credits - YouTube Creator Lead Exporter

This is the first MVP for collecting YouTube creator leads for Online CE Credits.

## What it does

- Searches YouTube around Online CE Credits niche keywords.
- Finds channels via both channel search and video search.
- Deduplicates by channel ID.
- Pulls public channel metadata.
- Extracts emails from public channel descriptions only.
- Marks missing emails as `manual_entry_required`.
- Exports CSVs.

## Important

This does not bypass YouTube's hidden "View email address" flow.  
It only extracts emails that creators publicly typed into their channel descriptions.

## Setup

```bash
pip install requests pandas python-dotenv
```

Create a `.env` file in the same folder:

```bash
YOUTUBE_API_KEY=your_api_key_here
```

Run:

```bash
python oce_youtube_creator_exporter.py
```

## Clone and run on another PC

1. Clone the repo:

```bash
git clone https://github.com/seo665/oce_youtube_creator_exporter.git
cd oce_youtube_creator_exporter
```

2. Create and activate the Python virtual environment:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
```

3. Install dependencies:

```powershell
pip install -r requirements.txt
```

4. Create a `.env` file with your API key:

```text
YOUTUBE_API_KEY=your_api_key_here
```

5. Run the tool:

```powershell
python oce_youtube_creator_exporter.py
```

## Output files

Inside the `/exports` folder:

- `oce_youtube_raw_search_DATE.csv`
- `oce_youtube_creator_leads_DATE.csv`
- `oce_youtube_email_found_DATE.csv`
- `oce_youtube_manual_entry_required_DATE.csv`

## First keyword set

- continued education
- continuing education
- emdr therapy
- continuing education in nursing management
- continuing education for estheticians
- continuing education credits
- cognitive behavioral therapy

Plus buyer-intent expansions for therapists, counselors, social workers, LPC, LMFT, LCSW, EMDR, CBT, DBT, and clinical CE.
