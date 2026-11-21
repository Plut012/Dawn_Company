// Sculpting for the diorama kit: many small shapes into one painted geometry (one draw call), the paint baked
// into vertex colours. Used by the figure, the foxhole and the trees.

import * as THREE from 'three';

const UP = new THREE.Vector3(0, 1, 0);
export const v = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z);

export class Sculpt {
  private position: number[] = [];
  private normal: number[] = [];
  private color: number[] = [];
  private surface: number[] = [];

  /** Add a shape, painted: base coat `paint`, lighter above and darker below. `wash` darkens by place. */
  add(shape: THREE.BufferGeometry, paint: string, rough: number, metal = 0, wash?: (p: THREE.Vector3) => number): this {
    const g = shape.index ? shape.toNonIndexed() : shape;
    const pos = g.getAttribute('position');
    const nor = g.getAttribute('normal');
    const base = new THREE.Color(paint);
    const p = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      const light = (0.8 + 0.36 * nor.getY(i)) * (wash ? wash(p) : 1);
      this.position.push(p.x, p.y, p.z);
      this.normal.push(nor.getX(i), nor.getY(i), nor.getZ(i));
      this.color.push(base.r * light, base.g * light, base.b * light);
      this.surface.push(rough, metal);
    }
    return this;
  }

  /** A tapered limb from a to b, rounded at both ends unless `rounded` is false. */
  limb(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, paint: string, rough: number, metal = 0, rounded = true): this {
    const along = b.clone().sub(a);
    const length = along.length();
    const turn = new THREE.Matrix4().makeRotationFromQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, along.normalize()));
    const place = turn.clone().setPosition(a.clone().add(b).multiplyScalar(0.5));
    this.add(new THREE.CylinderGeometry(rb, ra, length, 8, 1, true).applyMatrix4(place), paint, rough, metal);
    if (!rounded) return this;       // a bare stick (a trunk, a bough): 16 faces, not 176
    this.add(new THREE.SphereGeometry(ra, 8, 6).translate(a.x, a.y, a.z), paint, rough, metal);
    this.add(new THREE.SphereGeometry(rb, 8, 6).translate(b.x, b.y, b.z), paint, rough, metal);
    return this;
  }

  /** A ball at `at`, radius r, squashed by (sx, sy, sz). */
  ball(at: THREE.Vector3, r: number, paint: string, rough: number, squash: [number, number, number] = [1, 1, 1], wash?: (p: THREE.Vector3) => number): this {
    return this.add(new THREE.SphereGeometry(r, 10, 7).scale(...squash).translate(at.x, at.y, at.z), paint, rough, 0, wash);
  }

  /** A box centred at `at`, turned by the Euler angles given. */
  box(size: [number, number, number], at: THREE.Vector3, paint: string, rough: number, metal = 0, turn: [number, number, number] = [0, 0, 0]): this {
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(...turn)).setPosition(at);
    return this.add(new THREE.BoxGeometry(...size).applyMatrix4(m), paint, rough, metal);
  }

  /** Add triangles as they are: three points, normals and colours each, already in place and painted. */
  raw(position: number[], normal: number[], color: number[], rough: number): this {
    this.position.push(...position);
    this.normal.push(...normal);
    this.color.push(...color);
    for (let i = 0; i < position.length / 3; i++) this.surface.push(rough, 0);
    return this;
  }

  get empty(): boolean { return this.position.length === 0; }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.normal, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.color, 3));
    g.setAttribute('aSurface', new THREE.Float32BufferAttribute(this.surface, 2));
    return g;
  }
}

