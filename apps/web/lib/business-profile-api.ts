import { apiFetch } from "./api-client";
import { toBusinessProfileUpdatePayload, type BusinessProfile, type BusinessProfileInput } from "./business-profile-payload";

export { toBusinessProfileInput, toBusinessProfileUpdatePayload, type BusinessProfile, type BusinessProfileInput } from "./business-profile-payload";

export const businessProfileApi = {
  get: () => apiFetch<BusinessProfile | null>("/business-profile"),
  update: (input: BusinessProfileInput) => apiFetch<BusinessProfile>("/business-profile", { method: "PUT", body: JSON.stringify(toBusinessProfileUpdatePayload(input)) }),
};
