// Projet perso : CRÉATION au tap (QuickProject) ; MODIFICATION (?id=<id>) dans l'écran complet
// (AddProjectModal, devenu un écran de route), qui porte aussi les échéances ponctuelles.
import { useLocalSearchParams } from 'expo-router';
import AddProjectModal from '../../../components/project/AddProjectModal';
import QuickProject from '../../../components/project/QuickProject';

export default function ProjectScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  return id ? <AddProjectModal /> : <QuickProject />;
}
