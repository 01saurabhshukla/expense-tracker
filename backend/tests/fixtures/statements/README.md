# Sample bank statements (synthetic)

All data here is **fake**: generated names, account numbers, and transactions. The layouts imitate common Indian bank CSV/Excel exports, but real exports vary by branch, channel (net banking vs. app), and year. Treat these as realistic test fixtures, not exact replicas.

| File | Format notes | What it tests |
|---|---|---|
| `hdfc_sep2026.csv` | Preamble lines, `dd/mm/yy`, separate Withdrawal/Deposit columns, footer | Header detection, footer skipping |
| `sbi_sep2026.csv` | Long preamble, `1 Sep 2026` dates, Indian grouping `1,33,250.00`, blank cells are a single space | Date and amount parsing |
| `icici_sep2026.csv` | `S No.` column, `dd/mm/yyyy`, `0.00` instead of blank | Zero vs. empty handling |
| `axis_sep2026.csv` | `dd-mm-yyyy`, `DR`/`CR`/`BAL` headers | Column alias mapping |
| `kotak_sep2026.csv` | **Single Amount column + Dr/Cr flag** | Different shape: sign comes from an indicator column |
| `edge_hdfc_overlap_15sep_06oct.csv` | Repeats 15–30 Sep rows from the HDFC file, then adds 1–6 Oct | Row-level dedupe across overlapping statements |
| `edge_malformed_rows.csv` | 3 valid rows mixed with bad ones | Per-row error reporting without failing the file |
| `edge_header_only.csv` | Header, no data | 0-row upload |
| `edge_empty.csv` | 0 bytes | Empty file rejection |
| `edge_unrecognized_format.csv` | A valid CSV that isn't a bank statement | `UNRECOGNIZED_FORMAT` |
| `edge_corrupt_binary.csv` | Random bytes | Corrupt file handling |
| `generate-large-csv.js` | `node generate-large-csv.js 200000 large.csv` | Streaming and performance |

The HDFC file contains **two identical ₹20 CHAI POINT payments on 10 Sep**. Both are genuine, and only their closing balances differ, so your dedupe hash must keep both.

Uploading `hdfc_sep2026.csv` twice should return `409 DUPLICATE_FILE`.
