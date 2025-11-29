# FreestyleDeleteDomainVerificationRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**domain** | **str** | The domain to create a verification code for | 
**verification_code** | **str** | The verification code | 

## Example

```python
from freestyle_client.models.freestyle_delete_domain_verification_request import FreestyleDeleteDomainVerificationRequest

# TODO update the JSON string below
json = "{}"
# create an instance of FreestyleDeleteDomainVerificationRequest from a JSON string
freestyle_delete_domain_verification_request_instance = FreestyleDeleteDomainVerificationRequest.from_json(json)
# print the JSON string representation of the object
print(FreestyleDeleteDomainVerificationRequest.to_json())

# convert the object into a dict
freestyle_delete_domain_verification_request_dict = freestyle_delete_domain_verification_request_instance.to_dict()
# create an instance of FreestyleDeleteDomainVerificationRequest from a dict
freestyle_delete_domain_verification_request_from_dict = FreestyleDeleteDomainVerificationRequest.from_dict(freestyle_delete_domain_verification_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


