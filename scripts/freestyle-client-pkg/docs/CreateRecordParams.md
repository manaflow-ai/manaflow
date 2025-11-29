# CreateRecordParams


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**domain** | **str** |  | 
**record** | [**DnsRecordData**](DnsRecordData.md) |  | 

## Example

```python
from freestyle_client.models.create_record_params import CreateRecordParams

# TODO update the JSON string below
json = "{}"
# create an instance of CreateRecordParams from a JSON string
create_record_params_instance = CreateRecordParams.from_json(json)
# print the JSON string representation of the object
print(CreateRecordParams.to_json())

# convert the object into a dict
create_record_params_dict = create_record_params_instance.to_dict()
# create an instance of CreateRecordParams from a dict
create_record_params_from_dict = CreateRecordParams.from_dict(create_record_params_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


