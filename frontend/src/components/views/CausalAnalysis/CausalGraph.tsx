import React, { useMemo } from 'react';
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

export const CausalGraph: React.FC = () => {
  const { bundle } = useIncident();
  const { selectedNodeId, setSelectedNodeId } = useUI();

  const { dependencyGraph, currentTelemetry, causalAnalysis } = bundle || {};

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Auto-layout logic and state mapping
  useMemo(() => {
    if (!dependencyGraph) return;

    const newNodes: Node[] = [];
    const newEdges: Edge[] = [];
    
    // Quick layout based on service IDs (since this is a specific incident)
    // Left-to-Right orientation
    const positions: Record<string, { x: number, y: number }> = {
      api_gateway: { x: 50, y: 150 },
      patient_portal: { x: 400, y: 150 },
      appointment: { x: 750, y: 50 },
      notification: { x: 750, y: 250 },
      records: { x: 1100, y: 50 },
    };

    const defaultPos = { x: 100, y: 100 };

    // Find if a node is in the causal path
    const topHypothesis = causalAnalysis?.hypotheses?.[0];
    const topPath = causalAnalysis?.reconstructedPaths?.find(
      (p: any) => p.hypothesisId === `${topHypothesis?.serviceId}/${topHypothesis?.resource}`
    )?.nodes;

    dependencyGraph.nodes?.forEach((node: any) => {
      const isTopCandidate = topHypothesis?.serviceId === node.id;
      const serviceState = currentTelemetry?.services.find((s: any) => s.serviceId === node.id);
      newNodes.push({
        id: node.id,
        type: 'serviceNode',
        position: positions[node.id] || { x: (defaultPos.x += 100), y: (defaultPos.y += 50) },
        data: {
          serviceId: node.id,
          config: node,
          metrics: serviceState?.metrics,
          resources: serviceState?.resources,
          isTopCandidate,
          isSelected: selectedNodeId === node.id,
          onSelect: () => setSelectedNodeId(node.id === selectedNodeId ? null : node.id)
        },
      });
    });

    dependencyGraph.edges?.forEach((edge: any, i: number) => {
      // Check if this edge is in the causal propagation path
      let isCausal = false;
      if (topPath) {
        // Causal paths are built symptom -> root or root -> symptom.
        // If they are adjacent in the path, it's a causal edge.
        const sourceIndex = topPath.findIndex(p => p.serviceId === edge.from);
        const targetIndex = topPath.findIndex(p => p.serviceId === edge.to);
        if (sourceIndex !== -1 && targetIndex !== -1 && Math.abs(sourceIndex - targetIndex) === 1) {
          isCausal = true;
        }
      }

      newEdges.push({
        id: `e-${edge.from}-${edge.to}-${i}`,
        source: edge.from,
        target: edge.to,
        animated: isCausal, // Animate causal edges
        style: {
          stroke: isCausal ? '#F97316' : '#374151',
          strokeWidth: isCausal ? 4 : 2,
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isCausal ? '#F97316' : '#374151',
        },
      });
    });

    setNodes(newNodes);
    setEdges(newEdges);
  }, [dependencyGraph, currentTelemetry, causalAnalysis, selectedNodeId, setSelectedNodeId, setNodes, setEdges]);

  return (
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
  );
};
