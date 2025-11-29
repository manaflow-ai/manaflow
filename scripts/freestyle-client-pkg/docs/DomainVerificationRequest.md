# DomainVerificationRequest


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**id** | **str** |  | 
**domain** | **str** |  | 
**account_id** | **str** |  | 
**verification_code** | **str** |  | 
**created_at** | **datetime** |  | 

## Example

```python
from freestyle_client.models.domain_verification_request import DomainVerificationRequest

# TODO update the JSON string below
json = "{}"
# create an instance of DomainVerificationRequest from a JSON string
domain_verification_request_instance = DomainVerificationRequest.from_json(json)
# print the JSON string representation of the object
print(DomainVerificationRequest.to_json())

# convert the object into a dict
domain_verification_request_dict = domain_verification_request_instance.to_dict()
# create an instance of DomainVerificationRequest from a dict
domain_verification_request_from_dict = DomainVerificationRequest.from_dict(domain_verification_request_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


