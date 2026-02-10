import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { Project } from '../types/database';

const COLORS = {
  surface: '#0f172a',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  primary: '#34d399',
  border: '#1e293b',
  background: '#020617',
};

interface ProjectCarouselCardProps {
  project: Project;
}

export default function ProjectCarouselCard({ project }: ProjectCarouselCardProps) {
  const progress = useMemo(() => {
    if (project.target_amount <= 0) return 0;
    const accumulated = project.current_accumulated || 0;
    return Math.min(100, Math.round((accumulated / project.target_amount) * 100));
  }, [project.target_amount, project.current_accumulated]);

  // Monthly allocation text
  const monthlyText = project.monthly_allocation 
    ? `€${(project.monthly_allocation).toFixed(0)}/mois`
    : project.target_date 
      ? `Cible: ${project.target_date.split('-').reverse().join('-')}`
      : '-';

  const progressBarWidth = `${Math.max(progress, 1)}%`;

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: COLORS.surface,
          borderColor: COLORS.border,
        },
      ]}
    >
      {/* Header - Name + Progress % */}
      <View style={styles.header}>
        <Text numberOfLines={1} style={[styles.title, { color: COLORS.text }]}>
          {project.name}
        </Text>
        <Text style={[styles.progress, { color: COLORS.primary }]}>
          {progress}%
        </Text>
      </View>

      {/* Amount + Progress Bar (compact) */}
      <View style={styles.progressSection}>
        <View style={styles.amountCompact}>
          <Text style={[styles.amountSmall, { color: COLORS.primary }]}>
            €{(project.current_accumulated || 0).toFixed(0)}
          </Text>
          <Text style={[styles.targetSmall, { color: COLORS.textSecondary }]}>
            / €{project.target_amount.toFixed(0)}
          </Text>
        </View>
        <View
          style={[
            styles.progressBarContainer,
            { backgroundColor: COLORS.background, borderColor: COLORS.border },
          ]}
        >
          <View
            style={[
              styles.progressBar,
              { 
                width: progressBarWidth,
                backgroundColor: COLORS.primary,
              },
            ]}
          />
        </View>
      </View>

      {/* Allocation info - Footer */}
      <Text style={[styles.footer, { color: COLORS.textSecondary }]}>
        {monthlyText}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 2,
  },
  title: {
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  progress: {
    fontSize: 14,
    fontWeight: '700',
    marginLeft: 6,
  },
  progressSection: {
    gap: 4,
  },
  amountCompact: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
  },
  amountSmall: {
    fontSize: 12,
    fontWeight: '700',
  },
  targetSmall: {
    fontSize: 10,
  },
  progressBarContainer: {
    height: 2,
    borderRadius: 1,
    overflow: 'hidden',
    borderWidth: 0,
    maxWidth: '100%',
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  footer: {
    fontSize: 10,
    marginTop: 2,
  },
});
