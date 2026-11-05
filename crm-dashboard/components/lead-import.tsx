"use client";

import { useState } from "react";
import Papa from "papaparse";
import { createClient } from "@/lib/supabase/client";

const latestExport = "oce_youtube_creator_leads_2026-11-05_13-10-16.csv";

type ExportRow = Record<string, string>;

export default function LeadImport() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function importFile(file?: File) {
    if (!file) return;
    setError("");
    setMessage("");

    if (file.name !== latestExport) {
      setError(`For this workspace, select only ${latestExport}.`);
      return;
    }

    setBusy(true);
    try {
      const parsed = Papa.parse<ExportRow>(await file.text(), {
        header: true,
        skipEmptyLines: "greedy",
        transformHeader: (header) => header.trim(),
      });

      if (parsed.errors.length) {
        throw new Error(`Could not read the CSV: ${parsed.errors[0].message}`);
      }

      const rows = parsed.data.filter((row) => row.channel_id?.trim());
      if (!rows.length) {
        throw new Error("The selected CSV contains no channel records.");
      }

      const requiredHeaders = ["channel_id", "channel_name", "channel_url", "public_email"];
      const missingHeaders = requiredHeaders.filter((header) => !parsed.meta.fields?.includes(header));
      if (missingHeaders.length) {
        throw new Error(`The CSV is missing required columns: ${missingHeaders.join(", ")}.`);
      }

      const supabase = createClient();
      let inserted = 0;
      for (let offset = 0; offset < rows.length; offset += 100) {
        const batch = rows.slice(offset, offset + 100).map((row) => ({
          channel_id: row.channel_id.trim(),
          channel_name: row.channel_name?.trim() ?? "",
          channel_url: row.channel_url?.trim() ?? "",
          public_email: row.public_email?.trim() ?? "",
          subscriber_count: parseNumber(row.subscriber_count),
          lead_score: parseNumber(row.lead_score) ?? 0,
          data: row,
        }));

        const { data, error: insertError } = await supabase
          .from("leads")
          .upsert(batch, { onConflict: "channel_id", ignoreDuplicates: true })
          .select("id");

        if (insertError) {
          throw new Error(`Import stopped after ${inserted} records: ${insertError.message}`);
        }
        inserted += data?.length ?? 0;
      }

      setMessage(
        `Import complete: ${inserted} new leads added. ${rows.length - inserted} existing leads were left unchanged.`,
      );
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="import-card">
      <span className="section-eyebrow">Initial data</span>
      <h3>Import the latest search</h3>
      <p>Only the Nov 5, 2026 creator lead export is accepted. Existing CRM notes are preserved.</p>
      <label className={`button button-secondary full-width ${busy ? "is-disabled" : ""}`}>
        {busy ? "Importing…" : "Choose the Nov 5 CSV"}
        <input
          className="visually-hidden"
          type="file"
          accept=".csv,text/csv"
          disabled={busy}
          onChange={(event) => {
            void importFile(event.target.files?.[0]);
            event.currentTarget.value = "";
          }}
        />
      </label>
      {message && <p className="form-message success-message">{message}</p>}
      {error && <p className="form-message error-message">{error}</p>}
    </div>
  );
}

function parseNumber(value?: string) {
  if (!value?.trim()) return null;
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}
