# FreestyleDomainVerificationRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**domain** | **str** | The domain to create a verification code for | 

## Example

```python
from freestyle_client.models.freestyle_domain_verification_request import FreestyleDomainVerificationRequest

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleDomainVerificationRequest from a JSON string
freestyle_domain_verification_request_instance = FreestyleDomainVerificationRequest.from_json(json)
# print the JSON string representation of the object
print(FreestyleDomainVerificationRequest.to_json())

# convert the object into a dict
freestyle_domain_verification_request_dict = freestyle_domain_verification_request_instance.to_dict()
# create an instance of FreestyleDomainVerificationRequest from a dict
freestyle_domain_verification_request_from_dict = FreestyleDomainVerificationRequest.from_dict(freestyle_domain_verification_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


