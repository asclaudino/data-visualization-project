declare module "topojson-client" {
  export function feature(
    topology: any,
    object: any
  ): import("geojson").FeatureCollection<
    import("geojson").Geometry,
    Record<string, any>
  >;

  export function mesh(
    topology: any,
    object: any,
    filter?: (a: any, b: any) => boolean
  ): import("geojson").MultiLineString;

  export function meshArcs(
    topology: any,
    object: any,
    filter?: (a: any, b: any) => boolean
  ): import("geojson").MultiLineString;

  export function merge(
    topology: any,
    objects: any[]
  ): import("geojson").MultiPolygon;

  export function mergeArcs(
    topology: any,
    objects: any[]
  ): import("geojson").MultiPolygon;

  export function neighbors(objects: any[]): number[][];
}
