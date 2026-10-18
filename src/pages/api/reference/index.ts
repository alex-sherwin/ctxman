// POST /api/reference  body ReferenceInput -> 201 { reference, lastModified } + Location: /reference/<name>
// 400 invalid (issues) | bad-json, 409 exists, 415, 403. ROUND2_BACKEND_SPEC §C.3. References are read/written with
// reference-io.ts (fs + schema validation) at request time.
import type { APIRoute } from 'astro';
import { json, methodNotAllowed, readJson, referenceErrorResponse } from '../../../lib/http.ts';
import { createReference } from '../../../lib/reference-io.ts';

export const POST: APIRoute = async ({ request, url }) => {
  const body = await readJson(request, url);
  if (!body.ok) return body.response;
  try {
    const record = await createReference(body.value);
    return json({ reference: record.reference, lastModified: record.lastModified }, 201, {
      location: `/reference/${record.slug}`,
    });
  } catch (error) {
    return referenceErrorResponse(error, 'write');
  }
};

export const ALL: APIRoute = () => methodNotAllowed(['POST']);
