# google-ads-disapproval-checker-mcc
Scans client accounts under a Google Ads Manager (MCC) for disapproved Ads, Keywords,
# ⚠ Google Ads Disapprovals — MCC-Level Alert Script

A Google Ads Script that monitors **disapprovals for Ads, Keywords, and Extensions** across all accounts in a Manager Account (MCC).
It automatically groups accounts by label and emails a per-label report to the assigned recipient(s).  
Perfect for **agencies** or **large in-house teams** managing multiple accounts.

---

## Features
- Runs at the **MCC level** across all linked accounts.
- **Label → Recipient routing**: assign different managers to different accounts.
- Supports **multiple labels** and **multiple recipients**.
- Covers **Ads, Keywords, and Assets/Extensions disapprovals**.
- Includes **policy reasons** when available.
- **Always sends an email**, even if there are zero disapprovals (for peace of mind).
- Email subject line summarizes counts for quick triage.

---

## Setup Instructions

1. **In your MCC account**:  
   Go to **Tools & Settings → Bulk Actions → Scripts → + New Script**.

2. **Paste the script code** into the editor.

3. **Configure the `CONFIG` section**:
   - `DEFAULT_TO`: fallback email if no recipient is defined.
   - `LABEL_RECIPIENTS`: map account labels to recipient(s).  
     Example:
     ```javascript
     { label: 'Managed by Sam', to: 'sam@example.com', cc: '' }
     ```
   - Add as many label/recipient mappings as needed.

4. **Authorize the script** and run in Preview to confirm results.

5. **Schedule the script** (recommended: daily) so managers receive alerts automatically.

6. Make sure to label your accounts, For example: "Managed by Sam".

---

## Example Email Output

Subject:
```
⚠ Disapprovals — (Managed by Sam) — Ads: 2, KW: 1, Assets: 0
```

Body (summary example):
```
Account: Example Client
- Ads disapproved: 2 (Policy: Trademarks, Misrepresentation)
- Keywords disapproved: 1 (Policy: Gambling)
- Assets disapproved: 0

Total summary for label group:
Ads: 2 | Keywords: 1 | Assets: 0
```

If no disapprovals are found:
```
⚠ Disapprovals — (Managed by Sam) — NONE (Ads:0, KW:0, Assets:0)
```

---

## Author

**Sam Lalonde**  
[LinkedIn](https://www.linkedin.com/in/samlalonde/)  
---

## License

This project is licensed under the [MIT License](https://opensource.org/licenses/MIT).  
Free to use, modify, and distribute.
