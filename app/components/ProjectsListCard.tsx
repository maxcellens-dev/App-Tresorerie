import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Carousel from './Carousel';
import ProjectCarouselCard from './ProjectCarouselCard';
import type { Project } from '../types/database';

const COLORS = {
  bg: '#020617',
  card: '#0f172a',
  cardBorder: '#1e293b',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  emerald: '#34d399',
};

interface ProjectsListProps {
  projects: Project[];
  isLoading?: boolean;
  onViewAll?: () => void;
  onCreate?: () => void;
}

export default function ProjectsListCard({ projects, isLoading = false, onViewAll, onCreate }: ProjectsListProps) {
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

const styles = StyleSheet.create({
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
    color: COLORS.text,
  },
  count: {
    fontSize: 12,
    color: COLORS.textSecondary,
    backgroundColor: '#1e293b',
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
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  emptyHint: {
    fontSize: 11,
    color: COLORS.textSecondary,
  },

});
