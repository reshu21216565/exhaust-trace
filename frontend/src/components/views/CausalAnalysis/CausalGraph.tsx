import React, { useEffect, useMemo } from 'react';
import { useIncident } from '../../../lib/IncidentContext';
import { useUI } from '../../../lib/UIContext';
import {
  ReactFlow,
  Controls,
  Background,
  useNodesState,
  useEdgesState,
  MarkerType,
} from '@xyflow/react';
import type { Edge, Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ServiceNode } from './ServiceNode';

const nodeTypes = {
  serviceNode: ServiceNode,
};

const EVENT_WINDOW_TICKS = 30;

const DEFAULT_CANONICAL_GRAPH = {
  nodes: [
    { id: 'api_gateway', type: 'service' },
    { id: 'patient_portal', type: 'service' },
    { id: 'appointment', type: 'service' },
    { id: 'notification', type: 'service' },
    { id: 'records', type: 'service' },
  ],
  edges: [
    { from: 'api_gateway', to: 'patient_portal' },
    { from: 'patient_portal', to: 'appointment' },
    { from: 'patient_portal', to: 'notification' },
    { from: 'appointment', to: 'records' },
  ]
};

export const CausalGraph: React.FC = () => {
  const { bundle } = useIncident();
  const { selectedNodeId, setSelectedNodeId } = useUI();

  const { dependencyGraph, currentTelemetry, causalAnalysis, events = [], playback } = bundle || {};
  const liveTick = playback?.tick ?? 0;

  const activeEventNodes = useMemo(() => {
    if (!events.length) return new Set<string>();

    const serviceIds = new Set<string>();
    events.forEach((event: any) => {
      const eventTick = event?.tick ?? 0;
      const age = Math.max(0, liveTick - eventTick);
      if (age > EVENT_WINDOW_TICKS) return;

      if (event?.serviceId) serviceIds.add(event.serviceId);
      if (event?.callerService) serviceIds.add(event.callerService);
      if (event?.dependencyService) serviceIds.add(event.dependencyService);
    });

    return serviceIds;
  }, [events, liveTick]);

  const activeEventEdges = useMemo(() => {
    if (!events.length) return new Set<string>();

    const edgeIds = new Set<string>();
    events.forEach((event: any) => {
      const eventTick = event?.tick ?? 0;
      const age = Math.max(0, liveTick - eventTick);
      if (age > EVENT_WINDOW_TICKS) return;

      if (event?.callerService && event?.dependencyService) {
        edgeIds.add(`${event.callerService}->${event.dependencyService}`);
      }
    });

    return edgeIds;
  }, [events, liveTick]);

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const activeGraph = (dependencyGraph && dependencyGraph.nodes && dependencyGraph.nodes.length > 0)
    ? dependencyGraph
    : DEFAULT_CANONICAL_GRAPH;

  useEffect(() => {
    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];

    const positions: Record<string, { x: number, y: number }> = {
      api_gateway: { x: 50, y: 150 },
      patient_portal: { x: 400, y: 150 },
      appointment: { x: 750, y: 50 },
      notification: { x: 750, y: 250 },
      records: { x: 1100, y: 50 },
    };

    const defaultPos = { x: 100, y: 100 };

    const topHypothesis = causalAnalysis?.hypotheses?.[0];
    const topPath = causalAnalysis?.reconstructedPaths?.find(
      (p: any) => p.hypothesisId === `${topHypothesis?.serviceId}/${topHypothesis?.resource}`
    )?.nodes;

    activeGraph.nodes?.forEach((node: any) => {
      const isTopCandidate = topHypothesis?.serviceId === node.id;
      const serviceState = currentTelemetry?.services?.find((s: any) => s.serviceId === node.id);
      const isEventActive = activeEventNodes.has(node.id);

      newNodes.push({
        id: node.id,
        type: 'serviceNode',
        position: positions[node.id] || { x: (defaultPos.x += 100), y: (defaultPos.y += 50) },
        className: isEventActive ? 'event-node-pulse' : '',
        style: isEventActive ? {
          boxShadow: '0 0 18px rgba(251, 191, 36, 0.65)',
          borderRadius: 12,
          border: '1px solid rgba(251, 191, 36, 0.9)',
        } : undefined,
        data: {
          serviceId: node.id,
          config: node,
          metrics: serviceState?.metrics,
          resources: serviceState?.resources,
          isTopCandidate,
          isEventActive,
          isSelected: selectedNodeId === node.id,
          onSelect: () => setSelectedNodeId(node.id === selectedNodeId ? null : node.id)
        },
      });
    });

    activeGraph.edges?.forEach((edge: any, i: number) => {
      let isCausal = false;
      if (topPath) {
        const sourceIndex = topPath.findIndex(p => p.serviceId === edge.from);
        const targetIndex = topPath.findIndex(p => p.serviceId === edge.to);
        if (sourceIndex !== -1 && targetIndex !== -1 && Math.abs(sourceIndex - targetIndex) === 1) {
          isCausal = true;
        }
      }

      const edgeId = `${edge.from}->${edge.to}`;
      const isEventActive = activeEventEdges.has(edgeId);
      const active = isCausal || isEventActive;

      newEdges.push({
        id: `e-${edge.from}-${edge.to}-${i}`,
        source: edge.from,
        target: edge.to,
        animated: active,
        className: active ? 'event-edge-pulse' : '',
        style: {
          stroke: active ? '#FBBF24' : '#374151',
          strokeWidth: active ? 4 : 2,
          opacity: active ? 1 : 0.8,
          filter: active ? 'drop-shadow(0 0 6px rgba(251, 191, 36, 0.9))' : 'none',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: active ? '#FBBF24' : '#374151',
        },
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [activeGraph, currentTelemetry, causalAnalysis, selectedNodeId, setSelectedNodeId, setNodes, setEdges, activeEventNodes, activeEventEdges]);

  return (
    <>
      <style>{`
        .event-node-pulse {
          animation: exhausttraceEventPulse 900ms ease-in-out 2;
        }
        .event-edge-pulse {
          animation: exhausttraceEventStroke 900ms ease-in-out 2;
        }
        @keyframes exhausttraceEventPulse {
          0% { transform: scale(1); box-shadow: 0 0 0 rgba(251,191,36,0); }
          25% { transform: scale(1.02); box-shadow: 0 0 20px rgba(251,191,36,0.9); }
          100% { transform: scale(1); box-shadow: 0 0 0 rgba(251,191,36,0); }
        }
        @keyframes exhausttraceEventStroke {
          0% { stroke-dasharray: 0 8; opacity: 0.7; }
          35% { stroke-dasharray: 6 2; opacity: 1; }
          100% { stroke-dasharray: 0 8; opacity: 0.75; }
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        className="bg-background"
        minZoom={0.5}
        maxZoom={1.5}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#374151" gap={20} size={1} />
        <Controls />
      </ReactFlow>
    </>
  );
};
