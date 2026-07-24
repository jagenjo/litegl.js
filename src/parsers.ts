// Mesh format parsers and encoders for litegl.js.
//
// This is a SIDE-EFFECT module: it attaches the format parsers/encoders (OBJ, the ASCII "mesh"
// format and the binary "wbin" format) plus the compress/decompress helpers onto the already
// defined Mesh class and its static registries. It exports nothing. Importing it for its side
// effects registers everything.
//
// Ported verbatim (behavior preserved) from the original parsers.js to strict TypeScript.

import { Mesh } from "./mesh";
import type { MeshParser, MeshGroup, MeshInfo, TypedArray, TypedArrayConstructor } from "./mesh";
import { BBox } from "./geo";
import { typedArrayToArray } from "./utils";

/** A callable/newable typed-array constructor accepting a length or a source array. */
type TypedArrayCtorCallable = { new (arg: number | ArrayLike<number>): TypedArray };

/** A submesh group as produced/consumed by the OBJ parser (indices are dropped before output). */
interface OBJGroup {
  name: string;
  material: string;
  start: number;
  length: number;
  indices?: number[];
}

/** The intermediate mesh-data object built by the parsers before Mesh.load/configure. */
interface ParsedMesh {
  vertices?: Float32Array;
  normals?: Float32Array;
  coords?: Float32Array;
  triangles?: TypedArray;
  bounding?: Float32Array;
  info?: { groups?: OBJGroup[] };
}

//***** OBJ parser adapted from SpiderGL implementation *****************
/**
 * Parses a OBJ string and returns an object with the info ready to be passed to GL.Mesh.load
 * @method Mesh.parseOBJ
 * @param {String} data all the OBJ info to be parsed
 * @param {Object} options
 * @return {Object} mesh information (vertices, coords, normals, indices)
 */
function parseOBJ(
  text: string,
  options?: Record<string, unknown>
): Mesh | Record<string, unknown> | null {
  options = options || {};
  const MATNAME_EXTENSION = (options.matextension as string) || ""; //".json";
  const support_uint = true;

  //unindexed containers
  const vertices: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];

  //final containers
  const vertices_buffer_data: number[] = [];
  const normals_buffer_data: number[] = [];
  const uvs_buffer_data: number[] = [];

  //groups
  let group_id = 0;
  let groups: OBJGroup[] = [];
  let current_group_materials: Record<string, OBJGroup> = {};
  let last_group_name: string | null = null;
  const materials_found: Record<string, unknown> = {};
  let mtllib: string | null = null;
  let group = createGroup();

  const indices_map = new Map<string, number>();
  let next_index = 0;
  let s = 1; //scaling to change unit system
  if (options.scale) s = options.scale as number;

  const V_CODE = 1;
  const VT_CODE = 2;
  const VN_CODE = 3;
  const F_CODE = 4;
  const G_CODE = 5;
  const O_CODE = 6;
  const USEMTL_CODE = 7;
  const MTLLIB_CODE = 8;
  const codes: Record<string, number> = {
    v: V_CODE,
    vt: VT_CODE,
    vn: VN_CODE,
    f: F_CODE,
    g: G_CODE,
    o: O_CODE,
    usemtl: USEMTL_CODE,
    mtllib: MTLLIB_CODE,
  };

  let x = 0,
    y = 0,
    z = 0;

  const lines = text.split("\n");
  const length = lines.length;
  for (let lineIndex = 0; lineIndex < length; ++lineIndex) {
    let line = lines[lineIndex];
    line = line.replace(/[ \t]+/g, " ").replace(/\s\s*$/, ""); //better than trim

    if (line[line.length - 1] == "\\") {
      //breakline support
      lineIndex += 1;
      const next_line = lines[lineIndex].replace(/[ \t]+/g, " ").replace(/\s\s*$/, ""); //better than trim
      line = (line.substr(0, line.length - 1) + next_line).replace(/[ \t]+/g, " ").replace(/\s\s*$/, "");
    }

    if (line[0] == "#") continue;
    if (line == "") continue;

    const tokens = line.split(" ");
    const code = codes[tokens[0]];

    if (code <= VN_CODE) {
      //v,vt,vn
      x = parseFloat(tokens[1]);
      y = parseFloat(tokens[2]);
      if (code != VT_CODE)
        //not always present
        z = parseFloat(tokens[3]);
    }

    switch (code) {
      case V_CODE:
        x *= s;
        y *= s;
        z *= s;
        vertices.push(x, y, z);
        break;
      case VT_CODE:
        uvs.push(x, y);
        break;
      case VN_CODE:
        normals.push(x, y, z);
        break;
      case F_CODE: {
        if (tokens.length < 4) continue; //faces with less that 3 vertices? nevermind
        //get the triangle indices
        const polygon_indices: number[] = [];
        for (let i = 1; i < tokens.length; ++i) polygon_indices.push(getIndex(tokens[i]));
        group.indices!.push(polygon_indices[0], polygon_indices[1], polygon_indices[2]);
        //polygons are break intro triangles
        for (let i = 2; i < polygon_indices.length - 1; ++i)
          group.indices!.push(polygon_indices[0], polygon_indices[i], polygon_indices[i + 1]);
        break;
      }
      case G_CODE:
      case O_CODE: {
        //whats the difference?
        const name = tokens[1];
        last_group_name = name;
        if (!group.name) group.name = name;
        else {
          current_group_materials = {};
          group = createGroup(name);
        }
        break;
      }
      case USEMTL_CODE:
        changeMaterial(tokens[1]);
        break;
      case MTLLIB_CODE:
        mtllib = tokens[1];
        break;
      default:
    }
  }

  //generate indices
  let indices: number[] = [];
  let group_index = 0;
  const final_groups: OBJGroup[] = [];
  for (let i = 0; i < groups.length; ++i) {
    const g = groups[i];
    if (!g.indices) continue; //already added?
    g.start = group_index;
    g.length = g.indices.length;
    indices = indices.concat(g.indices);
    delete g.indices; //do not store indices in JSON format!
    group_index += g.length;
    final_groups.push(g);
  }
  groups = final_groups;

  //finish mesh
  const mesh: ParsedMesh = {};

  if (!vertices.length) {
    console.error("mesh without vertices");
    return null;
  }

  if (options.flip_normals && normals_buffer_data.length) {
    const nrm = normals_buffer_data;
    for (let i = 0; i < nrm.length; ++i) nrm[i] *= -1;
  }

  //create typed arrays
  mesh.vertices = new Float32Array(vertices_buffer_data);
  if (normals_buffer_data.length) mesh.normals = new Float32Array(normals_buffer_data);
  if (uvs_buffer_data.length) mesh.coords = new Float32Array(uvs_buffer_data);
  if (indices && indices.length > 0)
    mesh.triangles = new ((support_uint && group_index > 256 * 256 ? Uint32Array : Uint16Array) as TypedArrayCtorCallable)(
      indices
    );

  //extra info
  mesh.bounding = Mesh.computeBoundingBox(mesh.vertices);
  const info: { groups?: OBJGroup[] } = {};
  if (groups.length > 1) {
    info.groups = groups;
    //compute bounding of groups? //TODO: this is complicated, it is affected by indices, etc, better done afterwards
  }

  mesh.info = info;
  if (!mesh.bounding) {
    console.log("empty mesh");
    return null;
  }

  //if( mesh.bounding.radius == 0 || isNaN(mesh.bounding.radius))
  //	console.log("no radius found in mesh");
  //console.log(mesh);
  if (options.only_data) return mesh as unknown as Record<string, unknown>;

  //creates and returns a GL.Mesh
  let final_mesh: Mesh | null = null;
  final_mesh = Mesh.load(mesh as unknown as Record<string, unknown>, null, options.mesh as Mesh | null | undefined);
  //final_mesh.updateBoundingBox();
  return final_mesh;

  //this function helps reuse triplets that have been created before
  function getIndex(str: string): number {
    let pos: number, tex: number, nor: number;
    let f: string[] | undefined;
    let has_negative = false;

    //cannot use negative indices as keys, convert them to positive
    if (str.indexOf("-") == -1) {
      const index = indices_map.get(str);
      if (index !== undefined) return index;
    } else has_negative = true;

    if (!f)
      //maybe it was parsed before
      f = str.split("/");

    if (f.length == 1) {
      //unpacked
      pos = parseInt(f[0]);
      tex = pos;
      nor = pos;
    } else if (f.length == 2) {
      //no normals
      pos = parseInt(f[0]);
      tex = parseInt(f[1]);
      nor = pos;
    } else if (f.length == 3) {
      //all three indexed
      pos = parseInt(f[0]);
      tex = parseInt(f[1]);
      nor = parseInt(f[2]);
    } else {
      console.log("Problem parsing: unknown number of values per face");
      return -1;
    }

    //negative indices are relative to the end
    if (pos < 0) pos = vertices.length / 3 + pos + 1;
    if (nor < 0) nor = normals.length / 2 + nor + 1;
    if (tex < 0) tex = uvs.length / 2 + tex + 1;

    //try again to see if we already have this
    if (has_negative) {
      str = pos + "/" + tex + "/" + nor;
      const found = indices_map.get(str);
      if (found !== undefined) return found;
    }

    //fill buffers
    pos -= 1;
    tex -= 1;
    nor -= 1; //indices in obj start in 1, buffers in 0
    vertices_buffer_data.push(vertices[pos * 3 + 0], vertices[pos * 3 + 1], vertices[pos * 3 + 2]);
    if (uvs.length) uvs_buffer_data.push(uvs[tex * 2 + 0], uvs[tex * 2 + 1]);
    if (normals.length) normals_buffer_data.push(normals[nor * 3 + 0], normals[nor * 3 + 1], normals[nor * 3 + 2]);

    //store index
    const new_index = next_index;
    indices_map.set(str, new_index);
    ++next_index;
    return new_index;
  }

  function createGroup(name?: string): OBJGroup {
    const g: OBJGroup = {
      name: name || "",
      material: "",
      start: -1,
      length: -1,
      indices: [],
    };
    groups.push(g);
    return g;
  }

  function changeMaterial(material_name: string): OBJGroup {
    if (!group.material) {
      group.material = material_name + MATNAME_EXTENSION;
      current_group_materials[material_name] = group;
      return group;
    }

    let g = current_group_materials[material_name];
    if (!g) {
      g = createGroup(String(last_group_name) + "_" + material_name);
      g.material = material_name + MATNAME_EXTENSION;
      current_group_materials[material_name] = g;
    }
    group = g;
    return g;
  }
}

Mesh.parseOBJ = parseOBJ as typeof Mesh.parseOBJ;

/* old
Mesh.parseOBJ = function( text, options )
{
	options = options || {};

	//final arrays (packed, lineal [ax,ay,az, bx,by,bz ...])
	var positionsArray = [ ];
	var texcoordsArray = [ ];
	var normalsArray   = [ ];
	var indicesArray   = [ ];

	//unique arrays (not packed, lineal)
	var positions = [ ];
	var texcoords = [ ];
	var normals   = [ ];
	var facemap   = { };
	var index     = 0;

	var line = null;
	var f   = null;
	var pos = 0;
	var tex = 0;
	var nor = 0;
	var x   = 0.0;
	var y   = 0.0;
	var z   = 0.0;
	var tokens = null;

	var hasPos = false;
	var hasTex = false;
	var hasNor = false;

	var parsingFaces = false;
	var indices_offset = 0;
	var negative_offset = -1; //used for weird objs with negative indices
	var max_index = 0;

	var skip_indices = options.noindex ? options.noindex : (text.length > 10000000 ? true : false);
	//trace("SKIP INDICES: " + skip_indices);
	var flip_axis = options.flipAxis;
	var flip_normals = (flip_axis || options.flipNormals);

	//used for mesh groups (submeshes)
	var group = null;
	var groups = [];
	var materials_found = {};

	var V_CODE = 1;
	var VT_CODE = 2;
	var VN_CODE = 3;
	var F_CODE = 4;
	var G_CODE = 5;
	var O_CODE = 6;
	var codes = { v: V_CODE, vt: VT_CODE, vn: VN_CODE, f: F_CODE, g: G_CODE, o: O_CODE };


	var lines = text.split("\n");
	var length = lines.length;
	for (var lineIndex = 0;  lineIndex < length; ++lineIndex) {
		line = lines[lineIndex].replace(/[ \t]+/g, " ").replace(/\s\s*$/, ""); //trim

		if (line[0] == "#") continue;
		if(line == "") continue;

		tokens = line.split(" ");
		var code = codes[ tokens[0] ];

		if(parsingFaces && code == V_CODE) //another mesh?
		{
			indices_offset = index;
			parsingFaces = false;
			//trace("multiple meshes: " + indices_offset);
		}

		//read and parse numbers
		if( code <= VN_CODE ) //v,vt,vn
		{
			x = parseFloat(tokens[1]);
			y = parseFloat(tokens[2]);
			if( code != VT_CODE )
			{
				if(tokens[3] == '\\') //super weird case, OBJ allows to break lines with slashes...
				{
					//HACK! only works if the var is the thirth position...
					++lineIndex;
					line = lines[lineIndex].replace(/[ \t]+/g, " ").replace(/\s\s*$/, ""); //better than trim
					z = parseFloat(line);
				}
				else
					z = parseFloat(tokens[3]);
			}
		}

		if (code == V_CODE) {
			if(flip_axis) //maya and max notation style
				positions.push(-1*x,z,y);
			else
				positions.push(x,y,z);
		}
		else if (code == VT_CODE) {
			texcoords.push(x,y);
		}
		else if (code == VN_CODE) {

			if(flip_normals)  //maya and max notation style
				normals.push(-y,-z,x);
			else
				normals.push(x,y,z);
		}
		else if (code == F_CODE) {
			parsingFaces = true;

			if (tokens.length < 4) continue; //faces with less that 3 vertices? nevermind

			//for every corner of this polygon
			var polygon_indices = [];
			for (var i=1; i < tokens.length; ++i)
			{
				if (!(tokens[i] in facemap) || skip_indices)
				{
					f = tokens[i].split("/");

					if (f.length == 1) { //unpacked
						pos = parseInt(f[0]) - 1;
						tex = pos;
						nor = pos;
					}
					else if (f.length == 2) { //no normals
						pos = parseInt(f[0]) - 1;
						tex = parseInt(f[1]) - 1;
						nor = -1;
					}
					else if (f.length == 3) { //all three indexed
						pos = parseInt(f[0]) - 1;
						tex = parseInt(f[1]) - 1;
						nor = parseInt(f[2]) - 1;
					}
					else {
						console.err("Problem parsing: unknown number of values per face");
						return false;
					}

					if(i > 3 && skip_indices) //break polygon in triangles
					{
						//first
						var pl = positionsArray.length;
						positionsArray.push( positionsArray[pl - (i-3)*9], positionsArray[pl - (i-3)*9 + 1], positionsArray[pl - (i-3)*9 + 2]);
						positionsArray.push( positionsArray[pl - 3], positionsArray[pl - 2], positionsArray[pl - 1]);
						pl = texcoordsArray.length;
						texcoordsArray.push( texcoordsArray[pl - (i-3)*6], texcoordsArray[pl - (i-3)*6 + 1]);
						texcoordsArray.push( texcoordsArray[pl - 2], texcoordsArray[pl - 1]);
						pl = normalsArray.length;
						normalsArray.push( normalsArray[pl - (i-3)*9], normalsArray[pl - (i-3)*9 + 1], normalsArray[pl - (i-3)*9 + 2]);
						normalsArray.push( normalsArray[pl - 3], normalsArray[pl - 2], normalsArray[pl - 1]);
					}

					//add new vertex
					x = 0.0;
					y = 0.0;
					z = 0.0;
					if ((pos * 3 + 2) < positions.length) {
						hasPos = true;
						x = positions[pos*3+0];
						y = positions[pos*3+1];
						z = positions[pos*3+2];
					}
					positionsArray.push(x,y,z);

					//add new texture coordinate
					x = 0.0;
					y = 0.0;
					if ((tex * 2 + 1) < texcoords.length) {
						hasTex = true;
						x = texcoords[tex*2+0];
						y = texcoords[tex*2+1];
					}
					texcoordsArray.push(x,y);

					//add new normal
					x = 0.0;
					y = 0.0;
					z = 1.0;
					if(nor != -1)
					{
						if ((nor * 3 + 2) < normals.length) {
							hasNor = true;
							x = normals[nor*3+0];
							y = normals[nor*3+1];
							z = normals[nor*3+2];
						}

						normalsArray.push(x,y,z);
					}

					//Save the string "10/10/10" and tells which index represents it in the arrays
					if(!skip_indices)
						facemap[tokens[i]] = index++;
				}//end of 'if this token is new (store and index for later reuse)'

				//store key for this triplet
				if(!skip_indices)
				{
					var final_index = facemap[tokens[i]];
					polygon_indices.push(final_index);
					if(max_index < final_index)
						max_index = final_index;
				}
			} //end of for every token on a 'f' line

			//polygons (not just triangles)
			if(!skip_indices)
			{
				for(var iP = 2; iP < polygon_indices.length; iP++)
				{
					indicesArray.push( polygon_indices[0], polygon_indices[iP-1], polygon_indices[iP] );
					//indicesArray.push( [polygon_indices[0], polygon_indices[iP-1], polygon_indices[iP]] );
				}
			}
		}
		else if (code == G_CODE) { //tokens[0] == "usemtl"
			negative_offset = positions.length / 3 - 1;

			if(tokens.length > 1)
			{
				if(group != null)
				{
					group.length = indicesArray.length - group.start;
					if(group.length > 0)
						groups.push(group);
				}

				group = {
					name: tokens[1],
					start: indicesArray.length,
					length: -1,
					material: ""
				};
			}
		}
		else if (tokens[0] == "usemtl") {
			if(group)
				group.material = tokens[1];
		}
	}

	if(!positions.length)
	{
		console.error("OBJ doesnt have vertices, maybe the file is not a OBJ");
		return null;
	}

	if(group && (indicesArray.length - group.start) > 1)
	{
		group.length = indicesArray.length - group.start;
		groups.push(group);
	}

	//deindex streams
	if((max_index > 256*256 || skip_indices ) && indicesArray.length > 0)
	{
		console.log("Deindexing mesh...")
		var finalVertices = new Float32Array(indicesArray.length * 3);
		var finalNormals = normalsArray && normalsArray.length ? new Float32Array(indicesArray.length * 3) : null;
		var finalTexCoords = texcoordsArray && texcoordsArray.length ? new Float32Array(indicesArray.length * 2) : null;
		for(var i = 0; i < indicesArray.length; i += 1)
		{
			finalVertices.set( positionsArray.slice( indicesArray[i]*3,indicesArray[i]*3 + 3), i*3 );
			if(finalNormals)
				finalNormals.set( normalsArray.slice( indicesArray[i]*3,indicesArray[i]*3 + 3 ), i*3 );
			if(finalTexCoords)
				finalTexCoords.set( texcoordsArray.slice(indicesArray[i]*2,indicesArray[i]*2 + 2 ), i*2 );
		}
		positionsArray = finalVertices;
		if(finalNormals)
			normalsArray = finalNormals;
		if(finalTexCoords)
			texcoordsArray = finalTexCoords;
		indicesArray = null;
	}

	//Create final mesh object
	var mesh = {};

	//create typed arrays
	if (hasPos)
		mesh.vertices = new Float32Array(positionsArray);
	if (hasNor && normalsArray.length > 0)
		mesh.normals = new Float32Array(normalsArray);
	if (hasTex && texcoordsArray.length > 0)
		mesh.coords = new Float32Array(texcoordsArray);
	if (indicesArray && indicesArray.length > 0)
		mesh.triangles = new Uint16Array(indicesArray);

	var info = {};
	//if(groups.length > 1) //???
		info.groups = groups;
	mesh.info = info;

	if(options.only_data)
		return mesh;

	//creates and returns a GL.Mesh
	var final_mesh = null;
	final_mesh = Mesh.load( mesh, null, options.mesh );
	final_mesh.updateBoundingBox();
	return final_mesh;
}
//*/

Mesh.parsers["obj"] = parseOBJ as unknown as MeshParser;

Mesh.encoders["obj"] = function (mesh: Mesh, _options?: Record<string, unknown>): unknown {
  //store vertices
  const verticesBuffer = mesh.getBuffer("vertices");
  if (!verticesBuffer) return null;

  const lines: string[] = [];
  lines.push("# Generated with liteGL.js by Javi Agenjo\n");

  const vertices = verticesBuffer.data;
  for (let i = 0; i < vertices.length; i += 3)
    lines.push("v " + vertices[i].toFixed(4) + " " + vertices[i + 1].toFixed(4) + " " + vertices[i + 2].toFixed(4));

  //store normals
  const normalsBuffer = mesh.getBuffer("normals");
  if (normalsBuffer) {
    lines.push("");
    const normals = normalsBuffer.data;
    for (let i = 0; i < normals.length; i += 3)
      lines.push("vn " + normals[i].toFixed(4) + " " + normals[i + 1].toFixed(4) + " " + normals[i + 2].toFixed(4));
  }

  //store uvs
  const coordsBuffer = mesh.getBuffer("coords");
  if (coordsBuffer) {
    lines.push("");
    const coords = coordsBuffer.data;
    for (let i = 0; i < coords.length; i += 2)
      lines.push("vt " + coords[i].toFixed(4) + " " + coords[i + 1].toFixed(4) + " " + " 0.0000");
  }

  let groups: MeshGroup[] = mesh.info.groups;

  //store faces
  const indicesBuffer = mesh.getIndexBuffer("triangles");
  if (indicesBuffer) {
    const indices = indicesBuffer.data;
    if (!groups || !groups.length) groups = [{ start: 0, length: indices.length, name: "mesh" }];
    for (let j = 0; j < groups.length; ++j) {
      const group = groups[j];
      lines.push("g " + group.name);
      let matname = group.material || "mat_" + j;
      if (matname.indexOf(".json") != -1)
        //remove json from matnames or mtl name wont match
        matname = matname.substr(0, matname.indexOf(".json"));
      lines.push("usemtl " + matname);
      const start = group.start;
      const end = start + group.length;
      for (let i = start; i < end; i += 3)
        lines.push(
          "f " +
            (indices[i] + 1) +
            "/" +
            (indices[i] + 1) +
            "/" +
            (indices[i] + 1) +
            " " +
            (indices[i + 1] + 1) +
            "/" +
            (indices[i + 1] + 1) +
            "/" +
            (indices[i + 1] + 1) +
            " " +
            (indices[i + 2] + 1) +
            "/" +
            (indices[i + 2] + 1) +
            "/" +
            (indices[i + 2] + 1)
        );
    }
  } //no indices
  else {
    if (!groups || !groups.length) groups = [{ start: 0, length: vertices.length / 3, name: "mesh" }];
    for (let j = 0; j < groups.length; ++j) {
      const group = groups[j];
      lines.push("g " + group.name);
      lines.push("usemtl " + (group.material || "mat_" + j));
      const start = group.start;
      const end = start + group.length;
      for (let i = start; i < end; i += 3)
        lines.push(
          "f " +
            (i + 1) +
            "/" +
            (i + 1) +
            "/" +
            (i + 1) +
            " " +
            (i + 2) +
            "/" +
            (i + 2) +
            "/" +
            (i + 2) +
            " " +
            (i + 3) +
            "/" +
            (i + 3) +
            "/" +
            (i + 3)
        );
    }
  }

  return lines.join("\n");
};

//simple format to output meshes in ASCII
function parseMesh(text: string, options?: Record<string, unknown>): Mesh | Record<string, unknown> {
  const opts = options || {};
  const mesh: Record<string, unknown> = {};

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i];
    const type = line[0];
    const t = line.substr(1).split(",");
    const name = t[0];

    if (type == "-") {
      //buffer
      let factor = 1;
      let datatype: TypedArrayConstructor = Float32Array;
      if (name == "weights" || name == "bone_indices") datatype = Uint8Array;
      if (name == "weights") factor = 255;
      const data = new (datatype as TypedArrayCtorCallable)(Number(t[1]));
      for (let j = 0; j < data.length; ++j) data[j] = Number(t[j + 2]) * factor;
      mesh[name] = data;
    } else if (type == "*") {
      //index
      let datatype: TypedArrayConstructor = Uint16Array;
      if (Number(t[1]) > 256 * 256) datatype = Uint32Array;
      const data = new (datatype as TypedArrayCtorCallable)(Number(t[1]));
      for (let j = 0; j < data.length; ++j) data[j] = Number(t[j + 2]);
      mesh[name] = data;
    } else if (type == "@") {
      //info
      if (name == "bones") {
        const bones: [string, number[]][] = [];
        const num_bones = Number(t[1]);
        for (let j = 0; j < num_bones; ++j) {
          const m = t.slice(3 + j * 17, 3 + (j + 1) * 17 - 1).map(Number);
          bones.push([t[2 + j * 17], m]);
        }
        mesh.bones = bones;
      } else if (name == "bind_matrix") mesh.bind_matrix = t.slice(1, 17).map(Number);
      else if (name == "groups") {
        const meshInfo: { groups: MeshGroup[] } = { groups: [] };
        mesh.info = meshInfo;
        const num_groups = Number(t[1]);
        for (let j = 0; j < num_groups; ++j) {
          const group: MeshGroup = {
            name: t[2 + j * 4],
            material: t[2 + j * 4 + 1],
            start: Number(t[2 + j * 4 + 2]),
            length: Number(t[2 + j * 4 + 3]),
          };
          meshInfo.groups.push(group);
        }
      }
    } else console.warn("type unknown: " + t[0]);
  }

  if (opts.only_data) return mesh;

  //creates and returns a GL.Mesh
  let final_mesh: Mesh | null = null;
  final_mesh = Mesh.load(mesh, null, opts.mesh as Mesh | null | undefined);
  final_mesh.updateBoundingBox();
  return final_mesh;
}

Mesh.parsers["mesh"] = parseMesh as unknown as MeshParser;

Mesh.encoders["mesh"] = function (mesh: Mesh, _options?: Record<string, unknown>): unknown {
  const lines: string[] = [];
  for (const i in mesh.vertexBuffers) {
    const buffer = mesh.vertexBuffers[i];
    const buffer_data = typedArrayToArray(buffer.data);
    if (buffer.normalize && buffer.data.constructor == Uint8Array) {
      //denormalize
      for (let j = 0; j < buffer_data.length; ++j) buffer_data[j] /= 255;
    }
    const line: unknown[] = ["-" + i, buffer.data.length, buffer.data, buffer_data];
    lines.push(line.join(","));
  }

  for (const i in mesh.indexBuffers) {
    const buffer = mesh.indexBuffers[i];
    const buffer_data = typedArrayToArray(buffer.data);
    const line: unknown[] = ["*" + i, buffer.data.length, buffer.data, buffer_data];
    lines.push(line.join(","));
  }

  if (mesh.bounding)
    lines.push((["@bounding", typedArrayToArray(mesh.bounding.subarray(0, 6))] as unknown[]).join(","));
  if (mesh.info && mesh.info.groups) {
    const groups_info: unknown[] = [];
    for (let j = 0; j < mesh.info.groups.length; ++j) {
      const group = mesh.info.groups[j];
      groups_info.push(group.name, group.material, group.start, group.length);
    }
    lines.push((["@groups", mesh.info.groups.length] as unknown[]).concat(groups_info).join(","));
  }

  if (mesh.bones)
    lines.push((["@bones", mesh.bones.length, (mesh.bones as unknown[]).flat()] as unknown[]).join(","));
  const bind_matrix = (mesh as unknown as { bind_matrix?: Float32Array | number[] }).bind_matrix;
  if (bind_matrix) lines.push((["@bind_matrix", typedArrayToArray(bind_matrix)] as unknown[]).join(","));

  return lines.join("\n");
};

/* BINARY FORMAT ************************************/

if (typeof WBin !== "undefined" && WBin) WBin.classes["Mesh"] = Mesh;

Mesh.binary_file_formats["wbin"] = true;

function fromBinary(
  data_array: ArrayBuffer | Uint8Array,
  options?: Record<string, unknown>
): Mesh | Record<string, unknown> {
  const opts = options || {};

  let o: Record<string, unknown>;
  if (data_array.constructor == ArrayBuffer) {
    if (typeof WBin === "undefined" || !WBin)
      throw "To use binary meshes you need to install WBin.js from https://github.com/jagenjo/litescene.js/blob/master/src/utils/wbin.js ";
    o = WBin.load(data_array as unknown as Uint8Array, true) as Record<string, unknown>;
  } else o = data_array as unknown as Record<string, unknown>;

  if (!o.info) console.warn("This WBin doesn't seem to contain a mesh. Classname: ", o["@classname"]);

  if (o.format) Mesh.decompress(o);

  const vertex_buffers: Record<string, unknown> = {};
  if (o.vertex_buffers) {
    const vb = o.vertex_buffers as string[];
    for (const i in vb) vertex_buffers[vb[i]] = o[vb[i]];
  } else {
    if (o.vertices) vertex_buffers.vertices = o.vertices;
    if (o.normals) vertex_buffers.normals = o.normals;
    if (o.coords) vertex_buffers.coords = o.coords;
    if (o.weights) vertex_buffers.weights = o.weights;
    if (o.bone_indices) vertex_buffers.bone_indices = o.bone_indices;
  }

  const index_buffers: Record<string, unknown> = {};
  if (o.index_buffers) {
    const ib = o.index_buffers as string[];
    for (const i in ib) index_buffers[ib[i]] = o[ib[i]];
  } else {
    if (o.triangles) index_buffers.triangles = o.triangles;
    if (o.wireframe) index_buffers.wireframe = o.wireframe;
  }

  const mesh: Record<string, unknown> = {
    vertex_buffers: vertex_buffers,
    index_buffers: index_buffers,
    bounding: o.bounding,
    info: o.info,
  };

  if (o.bones) {
    const bones = o.bones as Array<[string, NumberArray]>;
    mesh.bones = bones;
    //restore Float32array
    for (let i = 0; i < bones.length; ++i) bones[i][1] = mat4.clone(bones[i][1]);
    if (o.bind_matrix) mesh.bind_matrix = mat4.clone(o.bind_matrix as NumberArray);
  }

  if (o.morph_targets) mesh.morph_targets = o.morph_targets;

  if (opts.only_data) return mesh;

  //build mesh object
  const final_mesh = (opts.mesh as Mesh) || new Mesh();
  final_mesh.configure(mesh);
  return final_mesh;
}

Mesh.fromBinary = fromBinary as typeof Mesh.fromBinary;
Mesh.parsers["wbin"] = fromBinary as unknown as MeshParser;

Mesh.encoders["wbin"] = function (mesh: Mesh, options?: Record<string, unknown>): unknown {
  mesh.updateBoundingBox();
  return mesh.toBinary(options);
};

Mesh.prototype.toBinary = function (this: Mesh, options?: Record<string, unknown>): unknown {
  if (typeof WBin === "undefined" || !WBin)
    throw "to use Mesh.toBinary you need to have WBin included. Check the repository for wbin.js";

  if (!this.info) this.info = {} as MeshInfo;

  //clean data
  const o: Record<string, unknown> = {
    object_class: "Mesh",
    info: this.info,
    groups: (this as unknown as { groups?: unknown }).groups,
  };

  if (this.bones) {
    const bones: [string, number[]][] = [];
    //convert to array
    const src = this.bones as Array<[string, NumberArray]>;
    for (let i = 0; i < src.length; ++i) bones.push([src[i][0], mat4.toArray(src[i][1])]);
    o.bones = bones;
    const bind_matrix = (this as unknown as { bind_matrix?: unknown }).bind_matrix;
    if (bind_matrix) o.bind_matrix = bind_matrix;
  }

  //bounding box
  if (!this.bounding) this.updateBoundingBox();
  o.bounding = this.bounding;

  const vertex_buffers: string[] = [];
  const index_buffers: string[] = [];

  for (const i in this.vertexBuffers) {
    const stream = this.vertexBuffers[i];
    const name = stream.name as string;
    o[name] = stream.data;
    vertex_buffers.push(name);

    if (stream.name == "vertices") this.info.num_vertices = stream.data.length / 3;
  }

  for (const i in this.indexBuffers) {
    const stream = this.indexBuffers[i];
    o[i] = stream.data;
    index_buffers.push(i);
  }

  o.vertex_buffers = vertex_buffers;
  o.index_buffers = index_buffers;

  //compress wbin using the bounding
  if (Mesh.enable_wbin_compression)
    //apply compression
    Mesh.compress(o);

  //create pack file
  const bin = WBin.create(o, "Mesh");
  return bin;
};

Mesh.compress = function (o: Record<string, unknown>, format?: string): unknown {
  format = format || "bounding_compressed";
  o.format = {
    type: format,
  };

  const func = Mesh.compressors[format];
  if (!func) throw "compression format not supported:" + format;
  return func(o);
};

Mesh.decompress = function (o: Record<string, unknown>): unknown {
  if (!o.format) return;
  const format = o.format as { type: string };
  const func = Mesh.decompressors[format.type];
  if (!func) throw "decompression format not supported:" + format.type;
  return func(o);
};

Mesh.compressors["bounding_compressed"] = function (o: Record<string, unknown>): void {
  if (!o.vertex_buffers) throw "buffers not found";

  const min = BBox.getMin(o.bounding as Float32Array);
  const max = BBox.getMax(o.bounding as Float32Array);
  const range = vec3.sub(vec3.create(), max, min);

  const vertices = o.vertices as Float32Array | number[];
  const new_vertices = new Uint16Array(vertices.length);
  for (let i = 0; i < vertices.length; i += 3) {
    new_vertices[i] = ((vertices[i] - min[0]) / range[0]) * 65535;
    new_vertices[i + 1] = ((vertices[i + 1] - min[1]) / range[1]) * 65535;
    new_vertices[i + 2] = ((vertices[i + 2] - min[2]) / range[2]) * 65535;
  }
  o.vertices = new_vertices;

  if (o.normals) {
    const normals = o.normals as Float32Array | number[];
    const new_normals = new Uint8Array(normals.length);
    const normals_range = new_normals.constructor == Uint8Array ? 255 : 65535;
    for (let i = 0; i < normals.length; i += 3) {
      new_normals[i] = (normals[i] * 0.5 + 0.5) * normals_range;
      new_normals[i + 1] = (normals[i + 1] * 0.5 + 0.5) * normals_range;
      new_normals[i + 2] = (normals[i + 2] * 0.5 + 0.5) * normals_range;
    }
    o.normals = new_normals;
  }

  if (o.coords) {
    //compute uv bounding: [minu,minv,maxu,maxv]
    const coords = o.coords as Float32Array | number[];
    const uvs_bounding = [10000, 10000, -10000, -10000];
    for (let i = 0; i < coords.length; i += 2) {
      const u = coords[i];
      if (uvs_bounding[0] > u) uvs_bounding[0] = u;
      else if (uvs_bounding[2] < u) uvs_bounding[2] = u;
      const v = coords[i + 1];
      if (uvs_bounding[1] > v) uvs_bounding[1] = v;
      else if (uvs_bounding[3] < v) uvs_bounding[3] = v;
    }
    (o.format as { uvs_bounding?: number[] }).uvs_bounding = uvs_bounding;

    const new_coords = new Uint16Array(coords.length);
    const range2 = [uvs_bounding[2] - uvs_bounding[0], uvs_bounding[3] - uvs_bounding[1]];
    for (let i = 0; i < coords.length; i += 2) {
      new_coords[i] = ((coords[i] - uvs_bounding[0]) / range2[0]) * 65535;
      new_coords[i + 1] = ((coords[i + 1] - uvs_bounding[1]) / range2[1]) * 65535;
    }
    o.coords = new_coords;
  }

  if (o.weights) {
    const weights = o.weights as Float32Array | number[];
    const new_weights = new Uint16Array(weights.length); //using only one byte distorts the meshes a lot
    const weights_range = (new_weights.constructor as unknown) == Uint8Array ? 255 : 65535;
    for (let i = 0; i < weights.length; i += 4) {
      new_weights[i] = weights[i] * weights_range;
      new_weights[i + 1] = weights[i + 1] * weights_range;
      new_weights[i + 2] = weights[i + 2] * weights_range;
      new_weights[i + 3] = weights[i + 3] * weights_range;
    }
    o.weights = new_weights;
  }
};

Mesh.decompressors["bounding_compressed"] = function (o: Record<string, unknown>): void {
  const bounding = o.bounding as Float32Array;
  if (!bounding)
    throw "error in mesh decompressing data: bounding not found, cannot use the bounding decompression.";

  const min = BBox.getMin(bounding);
  const max = BBox.getMax(bounding);
  const range = vec3.sub(vec3.create(), max, min);

  const format = o.format as { type: string; uvs_bounding?: number[] };

  const inv8 = 1 / 255;
  const inv16 = 1 / 65535;
  const vertices = o.vertices as Float32Array | number[];
  const new_vertices = new Float32Array(vertices.length);
  for (let i = 0, l = vertices.length; i < l; i += 3) {
    new_vertices[i] = vertices[i] * inv16 * range[0] + min[0];
    new_vertices[i + 1] = vertices[i + 1] * inv16 * range[1] + min[1];
    new_vertices[i + 2] = vertices[i + 2] * inv16 * range[2] + min[2];
  }
  o.vertices = new_vertices;

  if (o.normals && (o.normals as TypedArray).constructor != Float32Array) {
    const normals = o.normals as Uint8Array | Uint16Array;
    const new_normals = new Float32Array(normals.length);
    const inormals_range = normals.constructor == Uint8Array ? inv8 : inv16;
    for (let i = 0, l = normals.length; i < l; i += 3) {
      new_normals[i] = normals[i] * inormals_range * 2.0 - 1.0;
      new_normals[i + 1] = normals[i + 1] * inormals_range * 2.0 - 1.0;
      new_normals[i + 2] = normals[i + 2] * inormals_range * 2.0 - 1.0;
      const N = new_normals.subarray(i, i + 3);
      vec3.normalize(N, N);
    }
    o.normals = new_normals;
  }

  if (o.coords && format.uvs_bounding && (o.coords as TypedArray).constructor != Float32Array) {
    const coords = o.coords as Uint16Array;
    const uvs_bounding = format.uvs_bounding;
    const range2 = [uvs_bounding[2] - uvs_bounding[0], uvs_bounding[3] - uvs_bounding[1]];
    const new_coords = new Float32Array(coords.length);
    for (let i = 0, l = coords.length; i < l; i += 2) {
      new_coords[i] = coords[i] * inv16 * range2[0] + uvs_bounding[0];
      new_coords[i + 1] = coords[i + 1] * inv16 * range2[1] + uvs_bounding[1];
    }
    o.coords = new_coords;
  }

  //bones are already in Uint8 format so dont need to compress them further, but weights yes
  if (o.weights && (o.weights as TypedArray).constructor != Float32Array) {
    //do we really need to unpack them? what if we use them like this?
    const weights = o.weights as Uint8Array | Uint16Array;
    const new_weights = new Float32Array(weights.length);
    const iweights_range = weights.constructor == Uint8Array ? inv8 : inv16;
    for (let i = 0, l = weights.length; i < l; i += 4) {
      new_weights[i] = weights[i] * iweights_range;
      new_weights[i + 1] = weights[i + 1] * iweights_range;
      new_weights[i + 2] = weights[i + 2] * iweights_range;
      new_weights[i + 3] = weights[i + 3] * iweights_range;
    }
    o.weights = new_weights;
  }
};
