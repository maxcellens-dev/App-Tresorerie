import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Carousel from './Carousel';
import ProjectCarouselCard from './ProjectCarouselCard';
import type { Project } from '../types/database';
import { useAppColors } from '../hooks/useAppColors';


interface ProjectsListProps {
  projects: Project[];
  isLoading?: boolean;
  onViewAll?: () => void;
  onCreate?: () => void;
}

export default function ProjectsListCard({ projects, isLoading = false, onViewAll, onCreate }: ProjectsListProps) {
  const COLORS = useAppColors();
  const styles = makeStyles(COLORS);
  const router = useRouter();
  const totalProjects = projects.length;

  const handleProjectPress = (projectId: string) => {
    // Navigate to projects list (carousel item click navigates to full list)
    router.push('/(tabs)/projects');
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Mes projets</Text>
        <View style={styles.headerRight}>
          <Text style={styles.count}>{totalProjects}</Text>
          {onCreate && (
            <TouchableOpacity onPress={onCreate} activeOpacity={0.7}>
              <Ionicons name="add-circle" size={24} color={COLORS.emerald} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {isLoading ? (
        <ActivityIndicator size="small" color={COLORS.emerald} style={styles.loader} />
      ) : projects.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Aucun projet</Text>
          <Text style={styles.emptyHint}>Créez votre premier projet</Text>
        </View>
      ) : (
        <Carousel
          items={projects}
          renderItem={({ item }) => <ProjectCarouselCard project={item} />}
          onItemPress={handleProjectPress}
          height={145}
          fillParent
        />
      )}
    </View>
  );
}

function makeStyles(c: any) {
  return StyleSheet.create({
  container: {
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text,
  },
  count: {
    fontSize: 12,
    color: c.textSecondary,
    backgroundColor: c.cardBorder,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  loader: {
    marginVertical: 20,
  },
  empty: {
    paddingVertical: 20,
    alignItems: 'center',
    gap: 4,
  },
  emptyText: {
    fontSize: 13,
    color: c.textSecondary,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 11,
    color: c.textSecondary,
  },

});
}
