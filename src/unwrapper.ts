// Texture coordinates generator (for lightmaps, etc)
// Work in progress, NOT FINISHED

import type { Mesh } from "./mesh";

/** An edge between two vertex indices. */
type Edge = [number, number];

/**
 * A region/chart of connected triangles sharing a similar normal orientation.
 * (Charts are grouped into Blocks, one per triplanar direction.)
 */
class Chart {
  width = -1;
  height = -1;
  x = -1;
  y = -1;
  area = -1;

  edges: Edge[] = [];
  triangles: Float32Array[] = [];

  /** Owning block, set by Block.addChart(). */
  block: Block | null = null;

  addTriangle(
    Ai?: unknown,
    Bi?: unknown,
    Ci?: unknown,
    A?: unknown,
    B?: unknown,
    C?: unknown
  ): void {
    //remove edge
    for (let i = 0; i < this.edges.length; ++i) {
      const edge = this.edges[i];
      if (edge[0] == Ai) {
      }
    }
    //add edges
    //add triangle
  }

  mergeWith(chart: Chart): void {
    //transfer edges
  }

  computeInfo(): void {
    //compute bounding and area
  }
}

/** A triplanar bucket holding charts and an edge->chart lookup map. */
class Block {
  by_edge: Record<string, Chart> = {};
  charts: Chart[] = [];

  addChart(chart: Chart): void {
    chart.block = this;
    this.charts.push(chart);
  }

  removeChart(chart: Chart): void {
    const index = this.charts.indexOf(chart);
    if (index != -1) this.charts.splice(index, 1);
    for (const edge of chart.edges) {
      delete this.by_edge[edge[0] + "," + edge[1]];
    }
  }
}

/**
 * Generates texture coordinates (UVs) for an indexed mesh using a triplanar
 * separation + chart packing approach. Work in progress, NOT FINISHED.
 */
export class Unwrapper {
  static Block = Block;
  static Chart = Chart;

  constructor(mesh: Mesh, options?: Record<string, unknown>) {
    const verticesBuffer = mesh.vertexBuffers["vertices"];
    const indicesBuffer = mesh.indexBuffers["triangles"];

    if (!indicesBuffer) {
      console.error("Only can generate UVs from indexed meshes");
      return;
    }

    const vertices = verticesBuffer.data as Float32Array;
    const indices = indicesBuffer.data as Uint16Array | Uint32Array;
    const num_triangles = indices.length / 3;

    //triplanar separation *********************
    const blocks: Block[] = [];
    for (let i = 0; i < 6; ++i) blocks[i] = new Unwrapper.Block();

    const AB = vec3.create();
    const BC = vec3.create();
    const CA = vec3.create();
    const N = vec3.create();

    //blocks: 0:+X, 1:-X, 2:+Y, 3:-Y, 4:+Z, 5:-Z
    const BVs = new Float32Array(6);
    const chart_candidates: (Chart | null)[] = new Array(3);

    //for every triangle add it to a chart in a block
    for (let i = 0; i < num_triangles; ++i) {
      const Ai = indices[i * 3];
      const Bi = indices[i * 3 + 1];
      const Ci = indices[i * 3 + 2];

      const A = vertices.subarray(Ai, Ai + 3);
      const B = vertices.subarray(Bi, Bi + 3);
      const C = vertices.subarray(Ci, Ci + 3);

      vec3.sub(AB, B, A);
      vec3.sub(BC, B, C);
      vec3.sub(CA, A, C);

      //compute normal
      vec3.cross(N, AB, CA); //we should us AC but doesnt matter, we will fix it
      const len = vec3.length(N);
      vec3.scale(N, N, -len); //reverse and normalize

      //compute which block belongs
      let max = -2;
      let block_id = -1;
      BVs[0] = N[0];
      BVs[1] = N[1];
      BVs[2] = N[2];
      BVs[3] = -N[0];
      BVs[4] = -N[1];
      BVs[5] = -N[2];
      for (let j = 0; j < 6; ++j) {
        if (BVs[j] < max) continue;
        block_id = j;
        max = BVs[j];
      }

      //get block
      const block = blocks[block_id];

      //search for chart
      const ABname = Ai + "," + Bi;
      const BCname = Bi + "," + Ci;
      const CAname = Ci + "," + Ai;

      chart_candidates[0] = block.by_edge[ABname];
      chart_candidates[1] = block.by_edge[BCname];
      chart_candidates[2] = block.by_edge[CAname];

      if (
        chart_candidates[0] &&
        chart_candidates[1] &&
        chart_candidates[0] != chart_candidates[1]
      ) {
        chart_candidates[0].mergeWith(chart_candidates[1]);
        block.removeChart(chart_candidates[1]);
        chart_candidates[1] = null;
      }

      if (
        chart_candidates[0] &&
        chart_candidates[2] &&
        chart_candidates[0] != chart_candidates[2]
      ) {
        chart_candidates[0].mergeWith(chart_candidates[2]);
        block.removeChart(chart_candidates[2]);
        chart_candidates[2] = null;
      }

      if (
        chart_candidates[1] &&
        chart_candidates[2] &&
        chart_candidates[1] != chart_candidates[2]
      ) {
        chart_candidates[1].mergeWith(chart_candidates[2]);
        block.removeChart(chart_candidates[2]);
        chart_candidates[2] = null;
      }

      let final_chart: Chart | null =
        chart_candidates[0] || chart_candidates[1] || chart_candidates[2];

      if (!final_chart) {
        final_chart = new Unwrapper.Chart();
        block.addChart(final_chart);
      }

      //add triangle to chart
      final_chart.addTriangle(A, B, C);
    }

    //put all charts together
    let final_chart_list: Chart[] = [];
    for (let i = 0; i < blocks.length; ++i) {
      const block = blocks[i];
      if (block) final_chart_list = final_chart_list.concat(block.charts);
    }

    //compute bounding and area of every chart
    let total_area = 0;
    for (let i = 0; i < final_chart_list.length; ++i) {
      const chart = final_chart_list[i];
      chart.computeInfo();
      total_area += chart.area;
    }

    //arrange charts from big to small
    final_chart_list.sort(function (A, B) {
      return A.area - B.area;
    });

    //compute best possible area size
    let area_size = Math.sqrt(total_area);
    for (let i = 0; i < final_chart_list.length; ++i) {
      const chart = final_chart_list[i];
      if (area_size < chart.width) area_size = chart.width;
      if (area_size < chart.height) area_size = chart.height;
    }

    const root = { x: 0, y: 0, width: area_size, height: area_size };

    //for every Chart
    //check in which region belongs
    //add it to the smallest where it fits
    //subdivide
    //no region found, increase size and restart
  }
}
