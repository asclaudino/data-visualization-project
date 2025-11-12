"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { feature, mesh } from "topojson-client";

type Topology = any;

// at the top of WorldMap.tsx
import type { Feature, FeatureCollection, Geometry } from "geojson";
type CountryFeature = Feature<Geometry, Record<string, any>>;

type WorldMapProps = {
  /** URL to your TopoJSON in public/, e.g. "/data/world-110m.json" */
  dataUrl: string;
  /** Name of the Topology object that holds countries. Common: "countries" (world-atlas), sometimes "units" */
  objectName?: string;
  /** Called when a country is clicked */
  onCountryClick?: (props: Record<string, any>) => void;
  /** Called when a country is hovered */
  onCountryHover?: (props: Record<string, any> | null) => void;
  /** Initial scale multiplier; tweak if you change projection */
  scale?: number;
  /** Optional CSS class for the wrapper */
  className?: string;
};

export default function WorldMap({
  dataUrl,
  objectName = "countries",
  onCountryClick,
  onCountryHover,
  scale = 180,
  className,
}: WorldMapProps) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const gRef = useRef<SVGGElement | null>(null);
  const [topology, setTopology] = useState<Topology | null>(null);
  const [error, setError] = useState<string | null>(null);

  // responsive container size
  const [width, setWidth] = useState<number>(800);
  const height = Math.max(360, Math.round(width * 0.55)); // nice aspect ratio for Natural Earth

  // fetch topojson once
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(dataUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const topo = (await res.json()) as Topology;
        if (alive) setTopology(topo);
      } catch (e: any) {
        if (alive) setError(`Failed to load map: ${e?.message || e}`);
      }
    })();
    return () => {
      alive = false;
    };
  }, [dataUrl]);

  // resize observer
  useEffect(() => {
    if (!wrapperRef.current) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        if (e.contentRect?.width) setWidth(Math.round(e.contentRect.width));
      }
    });
    ro.observe(wrapperRef.current);
    return () => ro.disconnect();
  }, []);

  // derive features/mesh
  const { countries, borders } = useMemo(() => {
    if (!topology) return { countries: null as any, borders: null as any };
    const obj =
      topology.objects?.[objectName] ??
      // fallback: pick the first object that looks like countries
      Object.values<any>(topology.objects || {}).find(
        (o: any) => o.type === "GeometryCollection"
      );
    const feat = obj ? feature(topology as any, obj) : null;
    const countryMesh = (() => {
      try {
        // this will draw shared borders between countries
        const keys = Object.keys(topology.objects || {});
        const primary = topology.objects?.[objectName] ?? topology.objects?.[keys[0]];
        if (!primary) return null;
        return mesh(topology as any, primary, (a: any, b: any) => a !== b);
      } catch {
        return null;
      }
    })();
    return { countries: feat, borders: countryMesh };
  }, [topology, objectName]);

  // projection + path
  const projection = useMemo(() => {
    const proj = d3.geoNaturalEarth1().precision(0.5);
    // scale & center
    proj.scale(scale).translate([width / 2, height / 2]);
    return proj;
  }, [width, height, scale]);

  const path = useMemo(() => d3.geoPath(projection), [projection]);

  // zoom behavior
  useEffect(() => {
    if (!svgRef.current || !gRef.current) return;
    const svg = d3.select(svgRef.current);
    const g = d3.select(gRef.current);

    const zoomed = (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
      g.attr("transform", event.transform.toString());
    };

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 8])
      .on("zoom", zoomed as any);

    svg.call(zoom as any);

    // double click to reset
    svg.on("dblclick.zoom", null).on("dblclick", () => {
      svg.transition().duration(350).call(zoom.transform as any, d3.zoomIdentity);
    });

    return () => {
      svg.on(".zoom", null);
    };
  }, [width, height]);

  // tooltip
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);

  // render countries whenever size/data change
  useEffect(() => {
    if (!countries || !gRef.current) return;

    const g = d3.select(gRef.current);
    const sphere = { type: "Sphere" } as d3.GeoSphere;

    // Graticule
    const graticule = d3.geoGraticule10();

    // Spheres & graticule
    const bg = g.selectAll<SVGPathElement, any>("path.map-sphere").data([sphere]);
    bg
      .join(
        enter => enter.append("path").attr("class", "map-sphere"),
        update => update,
        exit => exit.remove()
      )
      .attr("d", path as any)
      .attr("fill", "var(--card)")
      .attr("stroke", "none");

    const grat = g.selectAll<SVGPathElement, any>("path.map-graticule").data([graticule]);
    grat
      .join(
        enter => enter.append("path").attr("class", "map-graticule"),
        update => update,
        exit => exit.remove()
      )
      .attr("d", path as any)
      .attr("fill", "none")
      .attr("stroke", "currentColor")
      .attr("stroke-opacity", 0.15)
      .attr("stroke-width", 0.6);

    // Countries
    const countrySel = g
      .selectAll<SVGPathElement, CountryFeature>("path.country")
      .data((countries as FeatureCollection<Geometry, any>).features, (d: any) => d.id || d.properties?.name);
        
    const enter = countrySel
      .enter()
      .append("path")
      .attr("class", "country")
      .attr("fill", "hsl(210 10% 92%)")
      .attr("stroke", "hsl(210 10% 60%)")
      .attr("stroke-width", 0.5)
      .attr("vector-effect", "non-scaling-stroke")
      .attr("d", path as any)
      .on("mousemove", (event: MouseEvent, d: CountryFeature) => {
        const name =
          d.properties?.name || d.properties?.NAME_EN || d.properties?.ADMIN || String(d.id ?? "Unknown");
      
        setTooltip({ x: event.clientX, y: event.clientY, text: name });
        onCountryHover?.(d.properties);
      
        d3.select(event.currentTarget as SVGPathElement).attr("fill", "hsl(210 25% 85%)");
      })
      .on("mouseleave", (event: MouseEvent, _d: CountryFeature) => {
        setTooltip(null);
        onCountryHover?.(null);
      
        d3.select(event.currentTarget as SVGPathElement).attr("fill", "hsl(210 10% 92%)");
      })
      .on("click", (_event: MouseEvent, d: CountryFeature) => {
        onCountryClick?.(d.properties);
      });
    
    countrySel.merge(enter as any).attr("d", path as any);
    countrySel.exit().remove();
    
    // Borders mesh (nice thin lines between countries)
    if (borders) {
      const borderSel = g.selectAll<SVGPathElement, any>("path.country-borders").data([borders]);
      borderSel
        .join(
          enter => enter.append("path").attr("class", "country-borders"),
          update => update,
          exit => exit.remove()
        )
        .attr("d", path as any)
        .attr("fill", "none")
        .attr("stroke", "hsl(210 10% 55%)")
        .attr("stroke-width", 0.4)
        .attr("vector-effect", "non-scaling-stroke");
    }
  }, [countries, borders, path, onCountryClick, onCountryHover]);

  return (
    <div ref={wrapperRef} className={className ?? "w-full"}>
      <div className="relative rounded-2xl border bg-card p-2 shadow-sm">
        <svg
          ref={svgRef}
          width="100%"
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="World map"
          className="block rounded-xl"
        >
          <g ref={gRef} />
        </svg>

        {/* Tooltip */}
        {tooltip && (
          <div
            className="pointer-events-none absolute z-10 rounded-md border bg-popover px-2 py-1 text-xs shadow"
            style={{
              left: tooltip.x + 12,
              top: tooltip.y - 28,
            }}
          >
            {tooltip.text}
          </div>
        )}
      </div>

      {error && (
        <p className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
