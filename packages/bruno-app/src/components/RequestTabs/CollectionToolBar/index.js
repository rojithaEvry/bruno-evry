import React, { useEffect, useState } from 'react';
import { uuid } from 'utils/common';
import { IconFiles, IconRun, IconEye, IconSettings, IconKey, IconCodePlus, IconLoader } from '@tabler/icons';
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
import path from 'path';

const CollectionToolBar = ({ collection }) => {
  const dispatch = useDispatch();
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingStatus, setGeneratingStatus] = useState('');

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

    // Setup listener for LLM generated requests results
    const handleGeneratedRequestsResult = (result) => {
      if (result.interim) {
        // This is an interim update
        toast.success(result.message || 'Processing controller...');
        setGeneratingStatus(result.message || 'Processing...');
        setIsGenerating(true);
        return;
      }

      setGeneratingStatus('');
      setIsGenerating(false);

      if (result.success) {
        const savedCount = result.endpoints?.filter((e) => e.saved).length || 0;
        const failedCount = result.endpoints?.filter((e) => !e.saved).length || 0;

        if (savedCount > 0) {
          const folderPath = result.endpoints[0].filePath
            ? path.dirname(result.endpoints[0].filePath)
            : 'unknown location';

          toast.success(
            <div>
              <p>Successfully generated {savedCount} requests</p>
              <p className="text-xs mt-1">Saved to: {folderPath}</p>
              {failedCount > 0 && <p className="text-xs mt-1 text-yellow-500">{failedCount} requests failed to save</p>}
            </div>,
            { duration: 5000 }
          );
        } else if (result.message) {
          toast.success(result.message);
        } else {
          toast.success('Successfully processed controller file');
        }
      } else {
        console.error('Error generating requests from controller:', result.error);
        toast.error(`Failed to generate requests: ${result.error || 'Unknown error'}`);
      }
    };
    const removeGenerateRequestListener = ipcRenderer.on('generate-requests-result', handleGeneratedRequestsResult);

    // Add listener for getting collection path by UID
    const handleGetCollectionPath = (payload) => {
      // Now payload is the direct object { collectionUid: 'xxx' }
      const requestedUid = payload?.collectionUid;
      console.log('Received request for collection path:', requestedUid);
      // Log the component's current collection UID for comparison
      console.log("Component's current collection UID:", collection?.uid);
      try {
        if (!requestedUid) {
          console.error('No collectionUid provided in payload:', payload);
          return;
        }

        if (collection && collection.uid === requestedUid) {
          // We have the collection object, send back the path
          console.log(`Found collection path in component: ${collection.pathname}`);
          ipcRenderer.send('renderer:collection-path-response', {
            collectionUid: requestedUid,
            collectionPath: collection.pathname
          });
        } else {
          // Try to find the collection in the store
          console.log(`Collection not found in component (Component UID: ${collection?.uid}), searching in store...`);
          const { store } = require('providers/ReduxStore');
          const state = store.getState();
          const collections = state.collections.collections;
          console.log(`Found ${collections.length} collections in store`);

          const foundCollection = collections.find((c) => c.uid === requestedUid);

          if (foundCollection) {
            console.log(`Found collection ${foundCollection.name} with path: ${foundCollection.pathname} in store`);
            ipcRenderer.send('renderer:collection-path-response', {
              collectionUid: requestedUid,
              collectionPath: foundCollection.pathname
            });
          } else {
            // Collection not found
            console.error(`Collection with UID ${requestedUid} not found in store`);
            console.log(
              'Available collections:',
              collections.map((c) => ({ name: c.name, uid: c.uid }))
            );
            ipcRenderer.send('renderer:collection-path-response', {
              collectionUid: requestedUid,
              error: 'Collection not found'
            });
          }
        }
      } catch (error) {
        console.error('Error handling collection path request:', error);
        ipcRenderer.send('renderer:collection-path-response', {
          collectionUid: requestedUid,
          error: error.message || 'Unknown error'
        });
      }
    };
    const removeGetCollectionPathListener = ipcRenderer.on('main:get-collection-path', handleGetCollectionPath);

    // Add listener for cancellation
    const handleGenerateRequestsCancelled = () => {
      console.log('Generate requests cancelled by user.');
      setGeneratingStatus('');
      setIsGenerating(false);
    };
    const removeGenerateCancelledListener = ipcRenderer.on(
      'generate-requests-cancelled',
      handleGenerateRequestsCancelled
    );

    // Clean up listeners on component unmount by calling the returned functions
    return () => {
      if (removeTokenListener) {
        removeTokenListener();
      }
      if (removeErrorListener) {
        removeErrorListener();
      }
      // Cleanup the new listener
      if (removeGenerateRequestListener) {
        removeGenerateRequestListener();
      }
      // Cleanup the collection path listener
      if (removeGetCollectionPathListener) {
        removeGetCollectionPathListener();
      }
      // Cleanup the cancellation listener
      if (removeGenerateCancelledListener) {
        removeGenerateCancelledListener();
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

  const handleGenerateRequests = () => {
    console.log('Requesting controller file selection...');
    // Log the collection UID being sent
    console.log('Sending generate request for collection UID:', collection?.uid);
    setIsGenerating(true); // Start loading indicator
    setGeneratingStatus('Selecting file...'); // Initial status
    const { ipcRenderer } = window;
    // Send message to main process to open file dialog and start the generation process
    ipcRenderer.send('generate-requests-from-controller', { collectionUid: collection.uid });
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
            <ToolHint text="Generate Requests from Controller" toolhintId="GenerateRequestsToolhintId" place="bottom">
              {isGenerating ? (
                <div className="flex items-center">
                  <IconLoader size={18} strokeWidth={1.5} className="animate-spin" />
                  {generatingStatus && <span className="ml-2 text-xs text-gray-500">{generatingStatus}</span>}
                </div>
              ) : (
                <IconCodePlus className="cursor-pointer" size={18} strokeWidth={1.5} onClick={handleGenerateRequests} />
              )}
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
