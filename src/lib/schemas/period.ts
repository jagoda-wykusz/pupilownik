import { z } from "zod";
import { countDays, MAX_SPAN_DAYS, MAX_TITLE_LENGTH } from "@/lib/period-format";

// Server-side contract for creating a care period. The API route is the source of
// truth — this schema is the single validation gate the handler (and the island, for
// UX) share. Mirror of the create_period_with_slots RPC signature (S-02).
//
// The span bound and the day count live in period-format.ts rather than here so the
// island can reuse them without pulling zod into the browser bundle. Duplicating the
// database's CHECK is deliberate: the CHECK is the guarantee, this is what turns a
// violation into a clean 400 instead of a 500.

export const createPeriodSchema = z
  .object({
    title: z
      .string()
      .trim()
      .min(1, "Nazwa wyjazdu jest wymagana")
      .max(MAX_TITLE_LENGTH, `Nazwa może mieć najwyżej ${MAX_TITLE_LENGTH} znaków`),
    start_date: z.iso.date("Podaj poprawną datę rozpoczęcia"),
    end_date: z.iso.date("Podaj poprawną datę zakończenia"),
  })
  .refine((value) => Date.parse(value.end_date) >= Date.parse(value.start_date), {
    message: "Data zakończenia nie może być wcześniejsza niż data rozpoczęcia",
    path: ["end_date"],
  })
  .refine((value) => countDays(value.start_date, value.end_date) <= MAX_SPAN_DAYS, {
    message: `Wyjazd może trwać najwyżej ${MAX_SPAN_DAYS} dni`,
    path: ["end_date"],
  });

export const periodIdSchema = z.uuid();

export type CreatePeriodInput = z.infer<typeof createPeriodSchema>;
