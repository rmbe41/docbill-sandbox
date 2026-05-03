import { useEffect, useRef, type ChangeEvent } from "react";
import { Input } from "@/components/ui/input";
import { loadGoogleMapsPlacesScript } from "@/lib/sandbox/loadGoogleMapsPlaces";

export type SandboxStreetPlaceDetails = {
  street: string;
  postalCode: string;
  city: string;
};

type Props = {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  onPlaceResolved?: (details: SandboxStreetPlaceDetails) => void;
  className?: string;
  placeholder?: string;
};

export function SandboxStreetAutocomplete({ id, value, onChange, onPlaceResolved, className, placeholder }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const onPlaceResolvedRef = useRef(onPlaceResolved);
  onPlaceResolvedRef.current = onPlaceResolved;

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

  useEffect(() => {
    if (!apiKey || typeof apiKey !== "string") return;
    const el = inputRef.current;
    if (!el) return;

    let cancelled = false;
    let autocomplete: google.maps.places.Autocomplete | undefined;
    let listener: google.maps.MapsEventListener | undefined;

    void loadGoogleMapsPlacesScript(apiKey).then(() => {
      if (cancelled || !el) return;
      autocomplete = new google.maps.places.Autocomplete(el, {
        types: ["address"],
        componentRestrictions: { country: ["de", "at", "ch"] },
        fields: ["address_components", "formatted_address"],
      });
      listener = autocomplete.addListener("place_changed", () => {
        const place = autocomplete!.getPlace();
        const comps = place.address_components;
        if (!comps?.length) return;

        let route = "";
        let streetNumber = "";
        let postalCode = "";
        let city = "";

        for (const c of comps) {
          if (c.types.includes("street_number")) streetNumber = c.long_name;
          if (c.types.includes("route")) route = c.long_name;
          if (c.types.includes("postal_code")) postalCode = c.long_name;
          if (c.types.includes("locality")) city = c.long_name;
          else if (!city && c.types.includes("postal_town")) city = c.long_name;
          else if (!city && c.types.includes("administrative_area_level_3")) city = c.long_name;
        }

        const streetLine = [route, streetNumber].filter(Boolean).join(" ").trim();
        const street =
          streetLine ||
          (place.formatted_address ?? "")
            .split(",")[0]
            ?.trim() ||
          "";

        onPlaceResolvedRef.current?.({ street, postalCode, city });
      });
    });

    return () => {
      cancelled = true;
      listener?.remove();
      if (typeof google !== "undefined" && google.maps?.event) {
        google.maps.event.clearInstanceListeners(el);
      }
    };
  }, [apiKey]);

  const common = {
    id,
    value,
    onChange: (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
    className,
    placeholder:
      placeholder ??
      (apiKey ? "Straße eingeben — Adressvorschläge (Google Maps)" : "Straße und Hausnummer"),
    autoComplete: "street-address" as const,
  };

  if (!apiKey) {
    return <Input {...common} />;
  }

  return <Input ref={inputRef} {...common} />;
}
