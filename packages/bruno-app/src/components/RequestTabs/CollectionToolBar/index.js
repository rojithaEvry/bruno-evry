import React, { useEffect } from 'react';
import { uuid } from 'utils/common';
import { IconFiles, IconRun, IconEye, IconSettings, IconKey } from '@tabler/icons';
import toast from 'react-hot-toast';
import EnvironmentSelector from 'components/Environments/EnvironmentSelector';
import GlobalEnvironmentSelector from 'components/GlobalEnvironments/EnvironmentSelector';
import { addTab } from 'providers/ReduxStore/slices/tabs';
import { useDispatch } from 'react-redux';
import { updateCollectionAuth } from 'providers/ReduxStore/slices/collections';
import { saveCollectionRoot } from 'providers/ReduxStore/slices/collections/actions';
import ToolHint from 'components/ToolHint';
import StyledWrapper from './StyledWrapper';
import JsSandboxMode from 'components/SecuritySettings/JsSandboxMode';

const CollectionToolBar = ({ collection }) => {
  const dispatch = useDispatch();

  useEffect(() => {
    const { ipcRenderer } = window;

    const handleTokenReceived = (token) => {
      // Restore original logic now that IPC is working
      console.log('IPC ms-auth-token RECEIVED raw value:', token);
      console.log('IPC ms-auth-token RECEIVED typeof value:', typeof token);

      if (token && typeof token === 'string') {
        console.log('Access Token received from main process and validated:', token);
        // Update collection auth mode to bearer and set the token
        dispatch(
          updateCollectionAuth({
            collectionUid: collection.uid,
            mode: 'bearer',
            content: {
              token: token
            }
          })
        );

        // Save the updated collection root to persist the change
        dispatch(saveCollectionRoot(collection.uid))
          .then(() => {
            toast.success('MS Auth Token set as Bearer Token for the collection!');
          })
          .catch((err) => {
            console.error('Failed to save collection root after MS Auth:', err);
            toast.error('Failed to save MS Auth Token to collection.');
          });
      } else {
        // Log the actual received value if it's not a valid token
        console.error('Received invalid or empty token from main process:', token);
        toast.error('Failed to acquire a valid MS Auth token via main process.');
      }
    };

    const handleErrorReceived = (error) => {
      // The actual event object isn't passed by our custom handler, so remove it
      console.error('MS Auth Error received from main process:', error);
      toast.error(`MS Auth failed in main process: ${error || 'Unknown error'}`);
    };

    // Set up listeners and store the cleanup functions returned by ipcRenderer.on
    const removeTokenListener = ipcRenderer.on('ms-auth-token', handleTokenReceived);
    const removeErrorListener = ipcRenderer.on('ms-auth-error', handleErrorReceived);

    // Clean up listeners on component unmount by calling the returned functions
    return () => {
      if (removeTokenListener) {
        removeTokenListener();
      }
      if (removeErrorListener) {
        removeErrorListener();
      }
    };
    // Add collection.uid to dependencies to ensure listener context is correct
  }, [dispatch, collection.uid]);

  const handleRun = () => {
    dispatch(
      addTab({
        uid: uuid(),
        collectionUid: collection.uid,
        type: 'collection-runner'
      })
    );
  };

  const viewVariables = () => {
    dispatch(
      addTab({
        uid: uuid(),
        collectionUid: collection.uid,
        type: 'variables'
      })
    );
  };

  const viewCollectionSettings = () => {
    dispatch(
      addTab({
        uid: collection.uid,
        collectionUid: collection.uid,
        type: 'collection-settings'
      })
    );
  };

  const handleMsAuthLogin = () => {
    console.log('Requesting MS Auth from main process (no payload needed)...');
    const { ipcRenderer } = window;
    // Send message to main process to initiate auth - no payload needed now
    ipcRenderer.send('open-ms-auth');
  };

  return (
    <StyledWrapper>
      <div className="flex items-center p-2">
        <div className="flex flex-1 items-center cursor-pointer hover:underline" onClick={viewCollectionSettings}>
          <IconFiles size={18} strokeWidth={1.5} />
          <span className="ml-2 mr-4 font-semibold">{collection?.name}</span>
        </div>
        <div className="flex flex-3 items-center justify-end">
          <span className="mr-2">
            <JsSandboxMode collection={collection} />
          </span>
          <span className="mr-3">
            <ToolHint text="MS Auth Login" toolhintId="MSAuthLoginToolhintId" place="bottom">
              <IconKey className="cursor-pointer" size={18} strokeWidth={1.5} onClick={handleMsAuthLogin} />
            </ToolHint>
          </span>
          <span className="mr-3">
            <ToolHint text="Runner" toolhintId="RunnnerToolhintId" place="bottom">
              <IconRun className="cursor-pointer" size={18} strokeWidth={1.5} onClick={handleRun} />
            </ToolHint>
          </span>
          <span className="mr-3">
            <ToolHint text="Variables" toolhintId="VariablesToolhintId">
              <IconEye className="cursor-pointer" size={18} strokeWidth={1.5} onClick={viewVariables} />
            </ToolHint>
          </span>
          <span className="mr-3">
            <ToolHint text="Collection Settings" toolhintId="CollectionSettingsToolhintId">
              <IconSettings className="cursor-pointer" size={18} strokeWidth={1.5} onClick={viewCollectionSettings} />
            </ToolHint>
          </span>
          <span>
            <GlobalEnvironmentSelector />
          </span>
          <EnvironmentSelector collection={collection} />
        </div>
      </div>
    </StyledWrapper>
  );
};

export default CollectionToolBar;
