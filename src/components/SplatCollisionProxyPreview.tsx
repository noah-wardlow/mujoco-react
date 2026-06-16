/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ThreeElements } from '@react-three/fiber';
import { useEffect, useMemo, useState } from 'react';
import type { SplatCollisionProxyConfig } from '../types';

export type SplatCollisionProxyPreviewVector3 = [number, number, number];

export interface SplatCollisionProxyGeomPreview {
  id: string;
  type: 'box' | 'plane' | 'sphere' | 'capsule' | 'mesh';
  position: SplatCollisionProxyPreviewVector3;
  size: number[];
}

export interface SplatCollisionProxyPreviewProps
  extends Omit<ThreeElements['group'], 'ref'> {
  collisionProxy?: SplatCollisionProxyConfig | null;
  xmlText?: string;
  fetchXml?: (xmlPath: string) => Promise<string>;
  color?: string;
  opacity?: number;
  planeColor?: string;
  planeOpacity?: number;
}

export type SplatCollisionProxyPreviewStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error';

export interface UseSplatCollisionProxyGeomsOptions {
  collisionProxy?: SplatCollisionProxyConfig | null;
  xmlText?: string;
  fetchXml?: (xmlPath: string) => Promise<string>;
  enabled?: boolean;
}

export interface SplatCollisionProxyGeomsState {
  geoms: SplatCollisionProxyGeomPreview[];
  status: SplatCollisionProxyPreviewStatus;
  error: Error | null;
  xmlPath?: string;
}

export function SplatCollisionProxyPreview({
  collisionProxy,
  xmlText,
  fetchXml = fetchSplatCollisionProxyXml,
  color = '#60a5fa',
  opacity = 0.12,
  planeColor = '#94a3b8',
  planeOpacity = 0.08,
  children,
  ...groupProps
}: SplatCollisionProxyPreviewProps) {
  const { geoms } = useSplatCollisionProxyGeoms({
    collisionProxy,
    xmlText,
    fetchXml,
  });

  if (geoms.length === 0 && !children) return null;

  return (
    <group
      {...groupProps}
      userData={{
        kind: 'splat-collision-proxy-preview',
        ...groupProps.userData,
      }}
    >
      {geoms.map((geom) => (
        <SplatCollisionProxyGeom
          key={geom.id}
          geom={geom}
          color={color}
          opacity={opacity}
          planeColor={planeColor}
          planeOpacity={planeOpacity}
        />
      ))}
      {children}
    </group>
  );
}

export function useSplatCollisionProxyGeoms({
  collisionProxy,
  xmlText,
  fetchXml = fetchSplatCollisionProxyXml,
  enabled = true,
}: UseSplatCollisionProxyGeomsOptions): SplatCollisionProxyGeomsState {
  const [loadedXmlText, setLoadedXmlText] = useState<string | null>(null);
  const [status, setStatus] =
    useState<SplatCollisionProxyPreviewStatus>('idle');
  const [error, setError] = useState<Error | null>(null);
  const xmlPath = collisionProxy?.xmlPath;

  useEffect(() => {
    let cancelled = false;

    if (!enabled) {
      setLoadedXmlText(null);
      setStatus('idle');
      setError(null);
      return undefined;
    }

    if (xmlText) {
      setLoadedXmlText(xmlText);
      setStatus('ready');
      setError(null);
      return undefined;
    }

    if (!xmlPath || !canFetchSplatCollisionProxyXml(xmlPath)) {
      setLoadedXmlText(null);
      setStatus('idle');
      setError(null);
      return undefined;
    }
    const fetchPath = xmlPath;

    async function loadProxyXml() {
      setStatus('loading');
      setError(null);

      try {
        const nextXmlText = await fetchXml(fetchPath);
        if (!cancelled) {
          setLoadedXmlText(nextXmlText);
          setStatus('ready');
        }
      } catch (nextError) {
        if (!cancelled) {
          setLoadedXmlText(null);
          setStatus('error');
          setError(
            nextError instanceof Error
              ? nextError
              : new Error('Unable to load collision proxy XML.')
          );
        }
      }
    }

    void loadProxyXml();

    return () => {
      cancelled = true;
    };
  }, [enabled, fetchXml, xmlPath, xmlText]);

  const geoms = useMemo(
    () => (loadedXmlText ? parseSplatCollisionProxyGeoms(loadedXmlText) : []),
    [loadedXmlText]
  );

  return useMemo(
    () => ({
      geoms,
      status,
      error,
      xmlPath,
    }),
    [error, geoms, status, xmlPath]
  );
}

export async function fetchSplatCollisionProxyXml(xmlPath: string) {
  const response = await fetch(xmlPath);
  if (!response.ok) {
    throw new Error(`Unable to load collision proxy XML (${response.status}).`);
  }
  return response.text();
}

export function canFetchSplatCollisionProxyXml(xmlPath: string) {
  return (
    xmlPath.startsWith('/') ||
    xmlPath.startsWith('http://') ||
    xmlPath.startsWith('https://')
  );
}

export function parseSplatCollisionProxyGeoms(
  xmlText: string
): SplatCollisionProxyGeomPreview[] {
  const parser = typeof DOMParser === 'undefined' ? null : new DOMParser();
  if (!parser) return [];

  const document = parser.parseFromString(xmlText, 'application/xml');
  if (document.querySelector('parsererror')) return [];

  const bodyPositions = new Map<Element, SplatCollisionProxyPreviewVector3>();

  for (const body of Array.from(document.querySelectorAll('body'))) {
    const parentBody = body.parentElement?.closest('body');
    const parentPosition: SplatCollisionProxyPreviewVector3 = parentBody
      ? bodyPositions.get(parentBody) ?? [0, 0, 0]
      : [0, 0, 0];
    bodyPositions.set(
      body,
      addProxyVectors(parentPosition, parseProxyVector(body.getAttribute('pos')))
    );
  }

  return Array.from(document.querySelectorAll('geom'))
    .map((geom, index): SplatCollisionProxyGeomPreview | null => {
      const type = getCollisionProxyGeomType(geom);
      if (!type) return null;
      const parentBody = geom.closest('body');
      const bodyPosition: SplatCollisionProxyPreviewVector3 = parentBody
        ? bodyPositions.get(parentBody) ?? [0, 0, 0]
        : [0, 0, 0];
      const position = addProxyVectors(
        bodyPosition,
        parseProxyVector(geom.getAttribute('pos'))
      );
      const size = parseNumberList(geom.getAttribute('size'));
      return {
        id: geom.getAttribute('name') ?? `${type}-${index}`,
        type,
        position,
        size,
      };
    })
    .filter((geom): geom is SplatCollisionProxyGeomPreview => Boolean(geom));
}

function SplatCollisionProxyGeom({
  geom,
  color,
  opacity,
  planeColor,
  planeOpacity,
}: {
  geom: SplatCollisionProxyGeomPreview;
  color: string;
  opacity: number;
  planeColor: string;
  planeOpacity: number;
}) {
  if (geom.type === 'sphere') {
    return (
      <mesh position={geom.position}>
        <sphereGeometry args={[geom.size[0] ?? 0.1, 16, 8]} />
        <SplatCollisionProxyMaterial color={color} opacity={opacity} />
      </mesh>
    );
  }

  if (geom.type === 'plane') {
    const width = geom.size[0] && geom.size[0] > 0 ? geom.size[0] * 2 : 4;
    const height = geom.size[1] && geom.size[1] > 0 ? geom.size[1] * 2 : 4;
    return (
      <mesh position={geom.position}>
        <boxGeometry args={[width, height, 0.02]} />
        <SplatCollisionProxyMaterial color={planeColor} opacity={planeOpacity} />
      </mesh>
    );
  }

  const size = getCollisionProxyBoxSize(geom);
  return (
    <mesh position={geom.position}>
      <boxGeometry args={size} />
      <SplatCollisionProxyMaterial color={color} opacity={opacity} />
    </mesh>
  );
}

function SplatCollisionProxyMaterial({
  color,
  opacity,
}: {
  color: string;
  opacity: number;
}) {
  return (
    <meshBasicMaterial
      color={color}
      transparent
      opacity={opacity}
      wireframe
    />
  );
}

function getCollisionProxyGeomType(
  geom: Element
): SplatCollisionProxyGeomPreview['type'] | null {
  const type = geom.getAttribute('type') ?? 'sphere';
  if (
    type === 'box' ||
    type === 'plane' ||
    type === 'sphere' ||
    type === 'capsule' ||
    type === 'mesh'
  ) {
    return type;
  }
  return null;
}

function getCollisionProxyBoxSize(
  geom: SplatCollisionProxyGeomPreview
): SplatCollisionProxyPreviewVector3 {
  if (geom.type === 'capsule') {
    const radius = geom.size[0] ?? 0.05;
    const halfLength = geom.size[1] ?? radius;
    return [radius * 2, radius * 2, Math.max(radius * 2, halfLength * 2)];
  }

  if (geom.type === 'mesh') return [0.2, 0.2, 0.2];

  return [
    (geom.size[0] ?? 0.1) * 2,
    (geom.size[1] ?? geom.size[0] ?? 0.1) * 2,
    (geom.size[2] ?? geom.size[0] ?? 0.1) * 2,
  ];
}

function parseProxyVector(
  value: string | null
): SplatCollisionProxyPreviewVector3 {
  const values = parseNumberList(value);
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0];
}

function parseNumberList(value: string | null) {
  if (!value) return [];
  return value
    .trim()
    .split(/\s+/)
    .map((part) => Number(part))
    .filter((part) => Number.isFinite(part));
}

function addProxyVectors(
  a: SplatCollisionProxyPreviewVector3,
  b: SplatCollisionProxyPreviewVector3
): SplatCollisionProxyPreviewVector3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
