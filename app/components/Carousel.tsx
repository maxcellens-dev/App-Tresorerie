import React, { useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  ScrollView,
  Dimensions,
  TouchableOpacity,
  Text,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const COLORS = {
  surface: '#0f172a',
  text: '#ffffff',
  textSecondary: '#94a3b8',
  primary: '#34d399',
  border: '#1e293b',
  background: '#020617',
};

interface CarouselItem {
  id: string;
  [key: string]: any;
}

interface ItemRendererProps<T extends CarouselItem = CarouselItem> {
  item: T;
  onPress: (id: string) => void;
  index: number;
}

interface CarouselProps<T extends CarouselItem = CarouselItem> {
  items: T[];
  renderItem: (props: ItemRendererProps<T>) => React.ReactNode;
  onItemPress: (id: string) => void;
  autoScrollInterval?: number; // ms between auto-scrolls
  itemWidth?: number; // pixels
  height?: number;
}

const screenWidth = Dimensions.get('window').width;

export default function Carousel<T extends CarouselItem = CarouselItem>({
  items,
  renderItem,
  onItemPress,
  autoScrollInterval = 5000,
  itemWidth = screenWidth - 32, // Default: full width minus padding
  height = 150,
}: CarouselProps<T>) {
  const scrollViewRef = useRef<ScrollView>(null);
  const autoScrollTimer = useRef<NodeJS.Timeout>();
  const currentIndexRef = useRef(0);

  useEffect(() => {
    if (items.length === 0) return;

    const startAutoScroll = () => {
      autoScrollTimer.current = setInterval(() => {
        const nextIndex = (currentIndexRef.current + 1) % items.length;
        currentIndexRef.current = nextIndex;
        
        scrollViewRef.current?.scrollTo({
          x: nextIndex * (itemWidth + 16), // 16 = gap
          animated: true,
        });
      }, autoScrollInterval);
    };

    startAutoScroll();

    return () => {
      if (autoScrollTimer.current) {
        clearInterval(autoScrollTimer.current);
      }
    };
  }, [items.length, autoScrollInterval, itemWidth]);

  const handleScroll = (event: any) => {
    const contentOffsetX = event.nativeEvent.contentOffset.x;
    const newIndex = Math.round(contentOffsetX / (itemWidth + 16));
    currentIndexRef.current = Math.min(newIndex, items.length - 1);
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <View style={[styles.container, { height }]}>
      <ScrollView
        ref={scrollViewRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleScroll}
        snapToInterval={itemWidth + 16}
        decelerationRate="fast"
        contentContainerStyle={styles.scrollContent}
      >
        {items.map((item, index) => (
          <TouchableOpacity
            key={item.id}
            onPress={() => onItemPress(item.id)}
            activeOpacity={0.7}
          >
            <View style={[styles.itemWrapper, { width: itemWidth }]}>
              {renderItem({ item, onPress: onItemPress, index })}
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>


    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
  },
  scrollContent: {
    paddingHorizontal: 16,
    gap: 16,
    paddingRight: 16,
  },
  itemWrapper: {
    height: '100%',
  },

});
