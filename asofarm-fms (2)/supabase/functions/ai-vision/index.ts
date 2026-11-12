// Advisory crop-photo check. The agronomist decides treatment; this only suggests likely causes.
import { admin, authorize, cors, json, openai, setting } from "../_shared/util.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const caller = await authorize(req, ["ops_manager", "supervisor", "research"]);
    if (!caller) return json({ error: "Not allowed" }, 403);
    const { case_id } = await req.json();
    if (!case_id) return json({ error: "case_id is required" }, 400);
    const db = admin();
    const { data: c } = await db.from("disease_cases").select("*").eq("id", case_id).maybeSingle();
    if (!c) return json({ error: "Case not found" }, 404);
    if (!c.photo_path) return json({ error: "Add a photo to the case first" }, 400);
    const { data: signed, error: se } = await db.storage.from("field-photos").createSignedUrl(c.photo_path, 300);
    if (se || !signed) return json({ error: "Could not read the photo" }, 500);
    const model = await setting(db, "openai_model", "gpt-4o-mini");
    const text = await openai([
      { role: "system", content: "You assist a Nigerian farm team with " + (c.crop ?? "cassava") + " crop health. From the photo and notes, list the most likely problems (for example cassava mosaic disease, cassava bacterial blight, green mite, mealybug, fall armyworm, nutrient deficiency), a confidence of low, medium or high for each, what else to check, immediate low-risk field steps, and when to call the agronomist. Be brief. State clearly that this is advisory only and a photo cannot confirm a diagnosis." },
      { role: "user", content: [
        { type: "text", text: "Symptoms noted by the team: " + (c.symptoms ?? "none") },
        { type: "image_url", image_url: { url: signed.signedUrl } },
      ] },
    ], model, 700);
    if (!text) return json({ error: "OPENAI_API_KEY is not set" }, 500);
    await db.from("disease_cases").update({ ai_assessment: text, status: c.status === "new" ? "assessed" : c.status }).eq("id", case_id);
    return json({ assessment: text });
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
