"use client";

import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from "react";
import * as d3 from "d3";
import { feature, mesh } from "topojson-client";

type Topology = any;

// at the top of WorldMap.tsx
import type { Feature, FeatureCollection, Geometry } from "geojson";
type CountryFeature = Feature<Geometry, Record<string, any>>;

type Tip = { x: number; y: number; text: string; show: boolean };

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
  const tipRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<Tip>({ x: 0, y: 0, text: "", show: false });

  // helper to clamp within wrapper
  const placeTip = (clientX: number, clientY: number, text: string) => {
    const wrap = wrapperRef.current!;
    const rect = wrap.getBoundingClientRect();

    // coords relative to wrapper
    const rawX = clientX - rect.left;
    const rawY = clientY - rect.top;

    // measure tooltip (fallback sizes)
    const w = tipRef.current?.offsetWidth ?? 60;
    const h = tipRef.current?.offsetHeight ?? 14;

    // small offset so it doesn’t sit under the cursor
    const PAD = 12;
    const MAX_X = rect.width - w - 8;
    const MAX_Y = rect.height - h - 8;

    const x = Math.min(Math.max(PAD, rawX + PAD), MAX_X);
    const y = Math.min(Math.max(PAD, rawY + PAD), MAX_Y);

    setTip({ x, y, text, show: true });
  };
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
          d.properties?.name ||
          d.properties?.NAME_EN ||
          d.properties?.ADMIN ||
          String(d.id ?? "Unknown");
            
        placeTip(event.clientX, event.clientY, name);
            
        onCountryHover?.(d.properties);
        d3.select(event.currentTarget as SVGPathElement)
          .attr("fill", "hsl(210 25% 85%)");
      })
      .on("mouseleave", (event: MouseEvent, _d: CountryFeature) => {
        setTip(t => ({ ...t, show: false }));   // hide via show flag
        setTip(t => ({ ...t, show: false }));   // (and keep your old state if you want)
        onCountryHover?.(null);
        d3.select(event.currentTarget as SVGPathElement)
          .attr("fill", "hsl(210 10% 92%)");
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
    <div className={className ?? ""}>
      {/* Make THIS the positioning context for both the SVG and the tooltip */}
      <div ref={wrapperRef} className="relative rounded-2xl border bg-card p-2 shadow-sm">
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
        {tip.show && (
          <div
            ref={tipRef}
            className="pointer-events-none absolute z-50 rounded-md border px-2 py-1 text-xs shadow-sm"
            style={{
              left: tip.x,   // numbers are fine; React treats as px
              top:  tip.y,
              backgroundColor: "hsl(120 60% 85%)", // light green
              color: "hsl(120 20% 20%)",           // dark green
            }}
          >
            {tip.text}
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      
    </div>
  );

}
