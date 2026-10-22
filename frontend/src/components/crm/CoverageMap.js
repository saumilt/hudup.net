import React from "react";
import { MapContainer, TileLayer, Circle, CircleMarker, Popup, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";

// Vector-only map (CircleMarker/Circle) so no Leaflet marker-icon assets are needed.
export default function CoverageMap({ origin, radiusMi = 0, cities = [], height = 420 }) {
  if (!origin || origin.lat == null) return null;
  const center = [origin.lat, origin.lon];
  const pts = (cities || []).filter((c) => c.lat != null && c.lon != null);
  const maxCount = Math.max(1, ...pts.map((c) => c.count || 1));
  const pinRadius = (c) => 6 + Math.round(16 * Math.sqrt((c.count || 1) / maxCount));
  const zoom = radiusMi > 75 ? 7 : radiusMi > 40 ? 8 : radiusMi > 15 ? 9 : 10;
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200" data-testid="coverage-map" style={{ height }}>
      <MapContainer key={`${origin.lat},${origin.lon},${radiusMi}`} center={center} zoom={zoom} style={{ height: "100%", width: "100%" }} scrollWheelZoom={false}>
        <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
        {radiusMi > 0 && (
          <Circle center={center} radius={radiusMi * 1609.34} pathOptions={{ color: "#0f766e", weight: 1.5, fillColor: "#0f766e", fillOpacity: 0.06 }} />
        )}
        {pts.map((c, i) => (
          <CircleMarker key={`${c.state}-${c.city}-${i}`} center={[c.lat, c.lon]} radius={pinRadius(c)}
            pathOptions={{ color: "#0f766e", weight: 1, fillColor: "#14b8a6", fillOpacity: 0.7 }}>
            <Tooltip direction="top">{c.city}: {c.count}</Tooltip>
            <Popup><b>{c.city}, {c.state}</b><br />{c.count} matching doctor{c.count === 1 ? "" : "s"}</Popup>
          </CircleMarker>
        ))}
        <CircleMarker center={center} radius={8} pathOptions={{ color: "#ffffff", weight: 2, fillColor: "#dc2626", fillOpacity: 1 }}>
          <Tooltip direction="top" permanent>{origin.label}</Tooltip>
        </CircleMarker>
      </MapContainer>
    </div>
  );
}
