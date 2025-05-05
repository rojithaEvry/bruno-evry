import React, { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import Modal from 'components/Modal';
import toast from 'react-hot-toast';
import { updateCollectionAuth } from 'providers/ReduxStore/slices/collections';
import { saveCollectionRoot } from 'providers/ReduxStore/slices/collections/actions';
import StyledWrapper from './StyledWrapper';
import get from 'lodash/get';

const AuthDialog = ({ isOpen, onClose, collection }) => {
  const dispatch = useDispatch();
  const [selectedOption, setSelectedOption] = useState('microsoft');
  const [environment, setEnvironment] = useState('dev');
  const [isLoading, setIsLoading] = useState(false);
  const [envVars, setEnvVars] = useState({
    AUTH_ENVIRONMENT: 'dev',
    SYSTEM_ADMIN_EMAIL: '',
    SYSTEM_ADMIN_PASSWORD: '',
    MEMBER_ADMIN_EMAIL: '',
    MEMBER_ADMIN_PASSWORD: ''
  });

  // Get the current bearer token from the collection for verification
  const verifyTokenWasSet = (token) => {
    setTimeout(() => {
      const bearerToken = get(collection, 'root.request.auth.bearer.token', '');
      console.log('Verifying token was set. Expected:', token);
      console.log('Current bearer token in collection:', bearerToken);

      if (bearerToken === token) {
        console.log('Token verification successful! Token was correctly set.');
      } else {
        console.warn('Token verification failed! Expected token does not match collection token.');
        console.log('Expected token length:', token.length);
        console.log('Collection token length:', bearerToken.length);
      }
    }, 500); // Small delay to allow state update
  };

  useEffect(() => {
    // Get environment variables from main process
    const { ipcRenderer } = window;

    const fetchEnvVars = async () => {
      try {
        // Send message to main process to get environment variables
        ipcRenderer.send('get-environment-variables');

        // Handle response from main process
        const handleEnvVarsReceived = (variables) => {
          console.log('Received environment variables from main process');
          setEnvVars({
            AUTH_ENVIRONMENT: variables.AUTH_ENVIRONMENT || 'dev',
            SYSTEM_ADMIN_EMAIL: variables.SYSTEM_ADMIN_EMAIL || '',
            SYSTEM_ADMIN_PASSWORD: variables.SYSTEM_ADMIN_PASSWORD || '',
            MEMBER_ADMIN_EMAIL: variables.MEMBER_ADMIN_EMAIL || '',
            MEMBER_ADMIN_PASSWORD: variables.MEMBER_ADMIN_PASSWORD || ''
          });
          setEnvironment(variables.AUTH_ENVIRONMENT || 'dev');
        };

        const removeListener = ipcRenderer.on('environment-variables-response', handleEnvVarsReceived);

        return () => {
          if (removeListener) {
            removeListener();
          }
        };
      } catch (error) {
        console.error('Error fetching environment variables:', error);
        toast.error('Failed to load authentication settings');
      }
    };

    // Set up API token response listener - this is used for both Evry Health logins
    const handleApiTokenReceived = (event, token) => {
      setIsLoading(false);
      console.log('Evry auth token received event triggered');
      console.log('Event:', event);
      console.log('Token received from main process:', token);
      console.log('Token type:', typeof token);

      if (token && typeof token === 'string' && token.length > 0) {
        console.log('Token length:', token.length);
        console.log('Token first 20 chars:', token.substring(0, 20) + '...');

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

        // Display a clearer success message based on the authentication method
        let authMethod = '';
        switch (selectedOption) {
          case 'microsoft':
            authMethod = 'Microsoft';
            break;
          case 'member':
            authMethod = 'Evry Health Member';
            break;
          case 'admin':
            authMethod = 'Evry Health System Admin';
            break;
          default:
            authMethod = '';
        }

        // Save the updated collection root to persist the change
        dispatch(saveCollectionRoot(collection.uid))
          .then(() => {
            toast.success(`${authMethod} token set as Bearer Token for the collection!`, {
              duration: 4000
            });
            console.log('Collection root saved successfully with new token');
            verifyTokenWasSet(token);
            onClose();
          })
          .catch((err) => {
            console.error('Failed to save collection root after login:', err);
            toast.error('Failed to save Auth Token to collection.');
          });
      } else {
        console.error('Received empty token from main process');
        console.error('Token value:', token);
        toast.error('Authentication succeeded but received an empty token');
      }
    };

    // Add MS auth token listener so we can handle it in the dialog
    const handleMsAuthTokenReceived = (event, token) => {
      setIsLoading(false);
      console.log('MS auth token received event triggered in AuthDialog');
      console.log('Token received from main process:', token);
      console.log('Token type:', typeof token);

      if (token && typeof token === 'string' && token.length > 0) {
        console.log('Token length:', token.length);
        console.log('Token first 20 chars:', token.substring(0, 20) + '...');

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
            toast.success(`Microsoft token set as Bearer Token for the collection!`, {
              duration: 4000
            });
            console.log('Collection root saved successfully with new token');
            verifyTokenWasSet(token);
            onClose();
          })
          .catch((err) => {
            console.error('Failed to save collection root after login:', err);
            toast.error('Failed to save MS Auth Token to collection.');
          });
      } else {
        console.error('Received empty MS token from main process');
        console.error('Token value:', token);
        toast.error('MS Authentication succeeded but received an empty token');
      }
    };

    const handleApiError = (event, error) => {
      console.error('API error from main process:', error);
      toast.error(`Login failed: ${error || 'Unknown error'}`, {
        duration: 4000
      });
      setIsLoading(false);
    };

    const handleMsAuthError = (event, error) => {
      console.error('MS Auth error from main process:', error);
      toast.error(`MS Auth failed: ${error || 'Unknown error'}`, {
        duration: 4000
      });
      setIsLoading(false);
    };

    const removeTokenListener = ipcRenderer.on('evry-auth-token', handleApiTokenReceived);
    const removeErrorListener = ipcRenderer.on('evry-auth-error', handleApiError);
    const removeMsTokenListener = ipcRenderer.on('ms-auth-token', handleMsAuthTokenReceived);
    const removeMsErrorListener = ipcRenderer.on('ms-auth-error', handleMsAuthError);

    fetchEnvVars();

    return () => {
      if (removeTokenListener) removeTokenListener();
      if (removeErrorListener) removeErrorListener();
      if (removeMsTokenListener) removeMsTokenListener();
      if (removeMsErrorListener) removeMsErrorListener();
    };
  }, [collection.uid, dispatch, onClose, selectedOption]);

  // Get API base URL based on environment
  const getApiBaseUrl = () => {
    return environment === 'dev' ? 'https://apidev.evryhealth.com' : 'https://api.evryhealth.com';
  };

  const handleMsAuthLogin = () => {
    console.log('Requesting MS Auth from main process...');
    toast.success('Opening Microsoft authentication window...', { duration: 2000 });
    setIsLoading(true);
    const { ipcRenderer } = window;
    ipcRenderer.send('open-ms-auth');
    // Don't close the dialog immediately to allow token reception
    // The dialog will close after the token is successfully saved
  };

  const handleEvryHealthMemberLogin = () => {
    setIsLoading(true);
    toast.success('Authenticating as Evry Health Member...', { duration: 2000 });
    try {
      if (!envVars.MEMBER_ADMIN_EMAIL || !envVars.MEMBER_ADMIN_PASSWORD) {
        toast.error('Missing Member login credentials in environment variables');
        setIsLoading(false);
        return;
      }

      const { ipcRenderer } = window;
      ipcRenderer.send('evry-member-login', {
        environment: environment,
        email: envVars.MEMBER_ADMIN_EMAIL,
        password: envVars.MEMBER_ADMIN_PASSWORD,
        collectionUid: collection.uid
      });
    } catch (error) {
      console.error('Error during Member login:', error);
      toast.error(`Member login failed: ${error.message || 'Unknown error'}`);
      setIsLoading(false);
    }
  };

  const handleEvryHealthSystemAdminLogin = () => {
    setIsLoading(true);
    toast.success('Authenticating as Evry Health System Admin...', { duration: 2000 });
    try {
      if (!envVars.SYSTEM_ADMIN_EMAIL || !envVars.SYSTEM_ADMIN_PASSWORD) {
        toast.error('Missing System Admin login credentials in environment variables');
        setIsLoading(false);
        return;
      }

      const { ipcRenderer } = window;
      ipcRenderer.send('evry-admin-login', {
        environment: environment,
        email: envVars.SYSTEM_ADMIN_EMAIL,
        password: envVars.SYSTEM_ADMIN_PASSWORD,
        collectionUid: collection.uid
      });
    } catch (error) {
      console.error('Error during System Admin login:', error);
      toast.error(`System Admin login failed: ${error.message || 'Unknown error'}`);
      setIsLoading(false);
    }
  };

  const handleAuthenticate = () => {
    switch (selectedOption) {
      case 'microsoft':
        handleMsAuthLogin();
        break;
      case 'member':
        handleEvryHealthMemberLogin();
        break;
      case 'admin':
        handleEvryHealthSystemAdminLogin();
        break;
      default:
        break;
    }
  };

  return (
    <Modal
      size="md"
      title="Authentication Options"
      handleCancel={onClose}
      handleConfirm={handleAuthenticate}
      confirmText="Authenticate"
      confirmDisabled={isLoading}
    >
      <StyledWrapper>
        <div className="mb-4">
          <label className="block font-medium mb-2">Select Authentication Method</label>
          <div className="radio-group">
            <div className="radio-option mb-2">
              <input
                type="radio"
                id="option-microsoft"
                name="auth-option"
                value="microsoft"
                checked={selectedOption === 'microsoft'}
                onChange={() => setSelectedOption('microsoft')}
              />
              <label htmlFor="option-microsoft" className="ml-2">
                Microsoft Authentication
              </label>
            </div>

            <div className="radio-option mb-2">
              <input
                type="radio"
                id="option-member"
                name="auth-option"
                value="member"
                checked={selectedOption === 'member'}
                onChange={() => setSelectedOption('member')}
              />
              <label htmlFor="option-member" className="ml-2">
                Evry Health Member
              </label>
            </div>

            <div className="radio-option mb-2">
              <input
                type="radio"
                id="option-admin"
                name="auth-option"
                value="admin"
                checked={selectedOption === 'admin'}
                onChange={() => setSelectedOption('admin')}
              />
              <label htmlFor="option-admin" className="ml-2">
                Evry Health System Admin
              </label>
            </div>
          </div>
        </div>

        {(selectedOption === 'member' || selectedOption === 'admin') && (
          <div className="mb-4">
            <label className="block font-medium mb-2">Environment</label>
            <div className="radio-group">
              <div className="radio-option mb-2">
                <input
                  type="radio"
                  id="env-dev"
                  name="environment"
                  value="dev"
                  checked={environment === 'dev'}
                  onChange={() => setEnvironment('dev')}
                />
                <label htmlFor="env-dev" className="ml-2">
                  Development
                </label>
              </div>

              <div className="radio-option mb-2">
                <input
                  type="radio"
                  id="env-prod"
                  name="environment"
                  value="prod"
                  checked={environment === 'prod'}
                  onChange={() => setEnvironment('prod')}
                />
                <label htmlFor="env-prod" className="ml-2">
                  Production
                </label>
              </div>
            </div>
          </div>
        )}

        {isLoading && <div className="text-center">Authenticating...</div>}
      </StyledWrapper>
    </Modal>
  );
};

export default AuthDialog;
