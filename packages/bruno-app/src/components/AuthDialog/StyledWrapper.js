import styled from 'styled-components';

const StyledWrapper = styled.div`
  .radio-group {
    margin-bottom: 1rem;
  }

  .radio-option {
    display: flex;
    align-items: center;
  }

  input[type='radio'] {
    cursor: pointer;
  }

  label {
    cursor: pointer;
  }
`;

export default StyledWrapper;
